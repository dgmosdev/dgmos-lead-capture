package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/dgmos/linkedin-import/internal/leads"
)

//go:embed schema.postgres.sql
var schemaPostgres string

//go:embed schema.mysql.sql
var schemaMySQL string

type Store struct {
	DB *sql.DB
	d  Dialect
}

type TokenRow struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

type LeadRow struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	ProfileURL   string    `json:"profile_url"`
	LinkedInURL  string    `json:"linkedin_url,omitempty"`
	Title        string    `json:"title,omitempty"`
	Company      string    `json:"company,omitempty"`
	Location     string    `json:"location,omitempty"`
	Email        string    `json:"email,omitempty"`
	Phone        string    `json:"phone,omitempty"`
	Website      string    `json:"website,omitempty"`
	Headline     string    `json:"headline,omitempty"`
	About        string    `json:"about,omitempty"`
	EnrichStatus string    `json:"enrich_status"`
	AIStatus     string    `json:"ai_status"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedAt    time.Time `json:"created_at"`
}

type LeadTotals struct {
	All       int `json:"all"`
	Listed    int `json:"listed"`
	Enriched  int `json:"enriched"`
	AINone    int `json:"ai_none"`
	AIPending int `json:"ai_pending"`
	AIDone    int `json:"ai_done"`
	AISkipped int `json:"ai_skipped"`
}

type ListLeadsResult struct {
	Items      []LeadRow  `json:"items"`
	NextCursor string     `json:"next_cursor,omitempty"`
	Totals     LeadTotals `json:"totals"`
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	info, err := parseDatabaseURL(databaseURL)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open(info.Driver, info.DSN)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{DB: db, d: info.Dialect}
	if err := s.Migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() {
	_ = s.DB.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.DB.PingContext(ctx)
}

func (s *Store) q(query string) string {
	return s.d.Rebind(query)
}

func (s *Store) Dialect() Dialect {
	return s.d
}

func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(64) PRIMARY KEY,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("schema_migrations: %w", err)
	}

	initSQL := schemaPostgres
	if s.d == DialectMySQL {
		initSQL = schemaMySQL
	}
	if err := s.applyMigration(ctx, "001_init", initSQL); err != nil {
		return err
	}
	if err := s.applyMigrationFn(ctx, "002_lead_status", s.migrateLeadStatus); err != nil {
		return err
	}
	if err := s.applyMigrationFn(ctx, "003_lead_audit", s.migrateLeadAudit); err != nil {
		return err
	}
	return nil
}

func (s *Store) applyMigration(ctx context.Context, version, sqlText string) error {
	return s.applyMigrationFn(ctx, version, func(ctx context.Context) error {
		for _, stmt := range splitSQL(sqlText) {
			if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("apply %s: %w", version, err)
			}
		}
		return nil
	})
}

func splitSQL(sqlText string) []string {
	parts := strings.Split(sqlText, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (s *Store) applyMigrationFn(ctx context.Context, version string, fn func(context.Context) error) error {
	var applied int
	err := s.DB.QueryRowContext(ctx, s.q(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`), version).Scan(&applied)
	if err != nil {
		return err
	}
	if applied > 0 {
		return nil
	}
	if err := fn(ctx); err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, s.q(`INSERT INTO schema_migrations (version) VALUES (?)`), version)
	return err
}

func (s *Store) migrateLeadStatus(ctx context.Context) error {
	ok, err := s.columnExists(ctx, "leads", "enrich_status")
	if err != nil || ok {
		return err
	}
	stmts := []string{
		`ALTER TABLE leads ADD COLUMN enrich_status VARCHAR(32) NOT NULL DEFAULT 'listed'`,
		`ALTER TABLE leads ADD COLUMN ai_status VARCHAR(32) NOT NULL DEFAULT 'none'`,
	}
	for _, stmt := range stmts {
		if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrateLeadAudit(ctx context.Context) error {
	hasCustomer, err := s.columnExists(ctx, "leads", "create_customer_id")
	if err != nil {
		return err
	}
	hasWorkspace, err := s.columnExists(ctx, "leads", "workspace_id")
	if err != nil {
		return err
	}
	if hasCustomer && !hasWorkspace {
		return nil
	}

	if !hasCustomer {
		for _, stmt := range s.addAuditColumnsSQL() {
			if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
				return err
			}
		}
	}

	if hasWorkspace {
		if _, err := s.DB.ExecContext(ctx, `
			UPDATE leads
			SET create_customer_id = workspace_id
			WHERE create_customer_id IS NULL OR create_customer_id = ''
		`); err != nil {
			return err
		}
		if _, err := s.DB.ExecContext(ctx, `
			UPDATE leads
			SET create_user_id = workspace_id
			WHERE create_user_id IS NULL OR create_user_id = ''
		`); err != nil {
			return err
		}
		if err := s.dropWorkspaceFromLeads(ctx); err != nil {
			return err
		}
	}

	if err := s.ensureLeadAuditIndexes(ctx); err != nil {
		return err
	}
	return s.notNullAuditColumns(ctx)
}

func (s *Store) addAuditColumnsSQL() []string {
	if s.d == DialectPostgres {
		return []string{
			`ALTER TABLE leads ADD COLUMN IF NOT EXISTS create_user_id UUID`,
			`ALTER TABLE leads ADD COLUMN IF NOT EXISTS create_customer_id UUID`,
			`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
		}
	}
	return []string{
		`ALTER TABLE leads ADD COLUMN create_user_id CHAR(36) NULL`,
		`ALTER TABLE leads ADD COLUMN create_customer_id CHAR(36) NULL`,
		`ALTER TABLE leads ADD COLUMN deleted_at DATETIME(3) NULL`,
	}
}

func (s *Store) notNullAuditColumns(ctx context.Context) error {
	if s.d == DialectPostgres {
		_, err := s.DB.ExecContext(ctx, `
			ALTER TABLE leads
			  ALTER COLUMN create_user_id SET NOT NULL,
			  ALTER COLUMN create_customer_id SET NOT NULL
		`)
		return err
	}
	_, err := s.DB.ExecContext(ctx, `
		ALTER TABLE leads
		  MODIFY create_user_id CHAR(36) NOT NULL,
		  MODIFY create_customer_id CHAR(36) NOT NULL
	`)
	return err
}

func (s *Store) dropWorkspaceFromLeads(ctx context.Context) error {
	if s.d == DialectPostgres {
		stmts := []string{
			`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_workspace_id_profile_url_key`,
			`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_workspace_id_fkey`,
			`DROP INDEX IF EXISTS idx_leads_workspace`,
			`DROP INDEX IF EXISTS idx_leads_updated`,
			`DROP INDEX IF EXISTS idx_leads_enrich`,
			`DROP INDEX IF EXISTS idx_leads_ai`,
			`ALTER TABLE leads DROP COLUMN IF EXISTS workspace_id`,
		}
		for _, stmt := range stmts {
			if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
				return err
			}
		}
		return nil
	}

	if name, err := s.mysqlFKName(ctx, "leads", "workspace_id"); err != nil {
		return err
	} else if name != "" {
		if _, err := s.DB.ExecContext(ctx, "ALTER TABLE leads DROP FOREIGN KEY "+name); err != nil {
			return err
		}
	}
	for _, idx := range []string{"idx_leads_workspace", "idx_leads_updated", "idx_leads_enrich", "idx_leads_ai", "workspace_id"} {
		_, _ = s.DB.ExecContext(ctx, "ALTER TABLE leads DROP INDEX "+idx)
	}
	_, err := s.DB.ExecContext(ctx, `ALTER TABLE leads DROP COLUMN workspace_id`)
	return err
}

func (s *Store) ensureLeadAuditIndexes(ctx context.Context) error {
	if s.d == DialectPostgres {
		stmts := []string{
			`CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_customer_profile ON leads (create_customer_id, profile_url)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(create_customer_id)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(create_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(create_customer_id, updated_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_enrich ON leads(create_customer_id, enrich_status)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_ai ON leads(create_customer_id, ai_status)`,
			`CREATE INDEX IF NOT EXISTS idx_leads_deleted ON leads(deleted_at)`,
		}
		for _, stmt := range stmts {
			if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
				return err
			}
		}
		return nil
	}
	for _, stmt := range []string{
		`CREATE UNIQUE INDEX uq_leads_customer_profile ON leads (create_customer_id, profile_url)`,
		`CREATE INDEX idx_leads_customer ON leads (create_customer_id)`,
		`CREATE INDEX idx_leads_user ON leads (create_user_id)`,
		`CREATE INDEX idx_leads_updated ON leads (create_customer_id, updated_at)`,
		`CREATE INDEX idx_leads_enrich ON leads (create_customer_id, enrich_status)`,
		`CREATE INDEX idx_leads_ai ON leads (create_customer_id, ai_status)`,
		`CREATE INDEX idx_leads_deleted ON leads (deleted_at)`,
	} {
		if _, err := s.DB.ExecContext(ctx, stmt); err != nil && !isMySQLDupIndex(err) {
			return err
		}
	}
	return nil
}

func isMySQLDupIndex(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key name") || strings.Contains(msg, "already exists")
}

func (s *Store) columnExists(ctx context.Context, table, column string) (bool, error) {
	q := `
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
	`
	if s.d == DialectPostgres {
		q = `
			SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?
		`
	}
	var n int
	err := s.DB.QueryRowContext(ctx, s.q(q), table, column).Scan(&n)
	return n > 0, err
}

func (s *Store) mysqlFKName(ctx context.Context, table, column string) (string, error) {
	var name string
	err := s.DB.QueryRowContext(ctx, s.q(`
		SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
		  AND REFERENCED_TABLE_NAME IS NOT NULL
		LIMIT 1
	`), table, column).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return name, err
}

func (s *Store) EnsureWorkspace(ctx context.Context, id, name string) error {
	if s.d == DialectPostgres {
		_, err := s.DB.ExecContext(ctx, s.q(`
			INSERT INTO workspaces (id, name)
			VALUES (?, ?)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
		`), id, name)
		return err
	}
	_, err := s.DB.ExecContext(ctx, s.q(`
		INSERT INTO workspaces (id, name)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE name = VALUES(name)
	`), id, name)
	return err
}

func (s *Store) WorkspaceName(ctx context.Context, id string) (string, error) {
	var name string
	err := s.DB.QueryRowContext(ctx, s.q(`SELECT name FROM workspaces WHERE id = ?`), id).Scan(&name)
	return name, err
}

func (s *Store) LookupToken(ctx context.Context, hash string) (workspaceID, tokenID string, err error) {
	err = s.DB.QueryRowContext(ctx, s.q(`
		SELECT workspace_id, id
		FROM extension_tokens
		WHERE token_hash = ?
	`), hash).Scan(&workspaceID, &tokenID)
	return
}

func (s *Store) TouchToken(ctx context.Context, tokenID string) {
	_, _ = s.DB.ExecContext(ctx, s.q(`UPDATE extension_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`), tokenID)
}

func (s *Store) ListTokens(ctx context.Context, workspaceID string) ([]TokenRow, error) {
	rows, err := s.DB.QueryContext(ctx, s.q(`
		SELECT id, label, created_at, last_used_at
		FROM extension_tokens
		WHERE workspace_id = ?
		ORDER BY created_at DESC
	`), workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TokenRow, 0)
	for rows.Next() {
		var t TokenRow
		var last sql.NullTime
		if err := rows.Scan(&t.ID, &t.Label, &t.CreatedAt, &last); err != nil {
			return nil, err
		}
		if last.Valid {
			t.LastUsedAt = &last.Time
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) InsertToken(ctx context.Context, workspaceID, hash, label string) (id string, createdAt time.Time, err error) {
	id = uuid.NewString()
	createdAt = time.Now().UTC()
	_, err = s.DB.ExecContext(ctx, s.q(`
		INSERT INTO extension_tokens (id, workspace_id, token_hash, label, created_at)
		VALUES (?, ?, ?, ?, ?)
	`), id, workspaceID, hash, label, createdAt)
	return
}

func (s *Store) DeleteToken(ctx context.Context, workspaceID, id string) (bool, error) {
	res, err := s.DB.ExecContext(ctx, s.q(`
		DELETE FROM extension_tokens WHERE workspace_id = ? AND id = ?
	`), workspaceID, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) UpsertLead(ctx context.Context, userID, customerID string, lead leads.Lead, pageURL string) (created, merged bool, err error) {
	metaBytes, _ := json.Marshal(map[string]any{
		"page_url": pageURL,
		"source":   "linkedin_extension",
	})
	meta := string(metaBytes)
	enrichStatus := leads.DeriveEnrichStatus(lead)
	aiStatus := lead.AIStatus
	if aiStatus == "" {
		aiStatus = leads.AINone
	}

	var existingID string
	var existingEnrich string
	err = s.DB.QueryRowContext(ctx, s.q(`
		SELECT id, enrich_status FROM leads
		WHERE create_customer_id = ? AND profile_url = ?
	`), customerID, lead.ProfileURL).Scan(&existingID, &existingEnrich)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		id := uuid.NewString()
		_, err = s.DB.ExecContext(ctx, s.q(`
			INSERT INTO leads (
				id, create_user_id, create_customer_id, name, profile_url, linkedin_url, title, company, location,
				email, phone, website, headline, about, enrich_status, ai_status, metadata
			) VALUES (
				?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
				NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
				?, ?, ?
			)
		`), id, userID, customerID, lead.Name, lead.ProfileURL, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
			lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus, aiStatus, meta)
		if err != nil {
			return false, false, err
		}
		return true, false, nil
	}

	if existingEnrich == leads.EnrichEnriched {
		enrichStatus = leads.EnrichEnriched
	}
	if s.d == DialectMySQL {
		return s.upsertLeadMySQL(ctx, existingID, customerID, lead, enrichStatus, aiStatus, meta)
	}

	res, err := s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`
		UPDATE leads SET
			name = CASE WHEN ? <> '' THEN ? ELSE name END,
			linkedin_url = COALESCE(NULLIF(?, ''), linkedin_url),
			title = COALESCE(NULLIF(?, ''), title),
			company = COALESCE(NULLIF(?, ''), company),
			location = COALESCE(NULLIF(?, ''), location),
			email = COALESCE(NULLIF(?, ''), email),
			phone = COALESCE(NULLIF(?, ''), phone),
			website = COALESCE(NULLIF(?, ''), website),
			headline = COALESCE(NULLIF(?, ''), headline),
			about = COALESCE(NULLIF(?, ''), about),
			enrich_status = CASE
				WHEN ? = 'enriched' THEN 'enriched'
				ELSE enrich_status
			END,
			ai_status = CASE
				WHEN ? <> '' AND ? <> 'none' THEN ?
				ELSE ai_status
			END,
			%s,
			deleted_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND create_customer_id = ?
		  AND (
			(? <> '' AND name IS DISTINCT FROM ?)
			OR (? <> '' AND linkedin_url IS DISTINCT FROM ?)
			OR (? <> '' AND title IS DISTINCT FROM ?)
			OR (? <> '' AND company IS DISTINCT FROM ?)
			OR (? <> '' AND location IS DISTINCT FROM ?)
			OR (? <> '' AND email IS DISTINCT FROM ?)
			OR (? <> '' AND phone IS DISTINCT FROM ?)
			OR (? <> '' AND website IS DISTINCT FROM ?)
			OR (? <> '' AND headline IS DISTINCT FROM ?)
			OR (? <> '' AND about IS DISTINCT FROM ?)
			OR (? = 'enriched' AND enrich_status IS DISTINCT FROM 'enriched')
			OR (? <> '' AND ? <> 'none' AND ai_status IS DISTINCT FROM ?)
			OR deleted_at IS NOT NULL
		  )
	`, s.d.MergeJSON("metadata"))),
		lead.Name, lead.Name, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus,
		aiStatus, aiStatus, aiStatus, meta, existingID, customerID,
		lead.Name, lead.Name, lead.LinkedInURL, lead.LinkedInURL, lead.Title, lead.Title,
		lead.Company, lead.Company, lead.Location, lead.Location, lead.Email, lead.Email,
		lead.Phone, lead.Phone, lead.Website, lead.Website, lead.Headline, lead.Headline,
		lead.About, lead.About, enrichStatus, aiStatus, aiStatus, aiStatus,
	)
	if err != nil {
		return false, false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, false, err
	}
	if n > 0 {
		return false, true, nil
	}
	return false, false, nil
}

func (s *Store) upsertLeadMySQL(ctx context.Context, existingID, customerID string, lead leads.Lead, enrichStatus, aiStatus, meta string) (created, merged bool, err error) {
	res, err := s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`
		UPDATE leads SET
			name = CASE WHEN ? <> '' THEN ? ELSE name END,
			linkedin_url = COALESCE(NULLIF(?, ''), linkedin_url),
			title = COALESCE(NULLIF(?, ''), title),
			company = COALESCE(NULLIF(?, ''), company),
			location = COALESCE(NULLIF(?, ''), location),
			email = COALESCE(NULLIF(?, ''), email),
			phone = COALESCE(NULLIF(?, ''), phone),
			website = COALESCE(NULLIF(?, ''), website),
			headline = COALESCE(NULLIF(?, ''), headline),
			about = COALESCE(NULLIF(?, ''), about),
			enrich_status = CASE WHEN ? = 'enriched' THEN 'enriched' ELSE enrich_status END,
			ai_status = CASE WHEN ? <> '' AND ? <> 'none' THEN ? ELSE ai_status END,
			%s,
			deleted_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND create_customer_id = ?
		  AND (
			(? <> '' AND NOT name <=> ?)
			OR (? <> '' AND NOT linkedin_url <=> ?)
			OR (? <> '' AND NOT title <=> ?)
			OR (? <> '' AND NOT company <=> ?)
			OR (? <> '' AND NOT location <=> ?)
			OR (? <> '' AND NOT email <=> ?)
			OR (? <> '' AND NOT phone <=> ?)
			OR (? <> '' AND NOT website <=> ?)
			OR (? <> '' AND NOT headline <=> ?)
			OR (? <> '' AND NOT about <=> ?)
			OR (? = 'enriched' AND NOT enrich_status <=> 'enriched')
			OR (? <> '' AND ? <> 'none' AND NOT ai_status <=> ?)
			OR deleted_at IS NOT NULL
		  )
	`, s.d.MergeJSON("metadata"))),
		lead.Name, lead.Name, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus,
		aiStatus, aiStatus, aiStatus, meta, existingID, customerID,
		lead.Name, lead.Name, lead.LinkedInURL, lead.LinkedInURL, lead.Title, lead.Title,
		lead.Company, lead.Company, lead.Location, lead.Location, lead.Email, lead.Email,
		lead.Phone, lead.Phone, lead.Website, lead.Website, lead.Headline, lead.Headline,
		lead.About, lead.About, enrichStatus, aiStatus, aiStatus, aiStatus,
	)
	if err != nil {
		return false, false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, false, err
	}
	if n > 0 {
		return false, true, nil
	}
	return false, false, nil
}

func (s *Store) UpdateLeadStatus(ctx context.Context, customerID, id, enrichStatus, aiStatus string) (bool, error) {
	sets := make([]string, 0, 3)
	args := []any{}
	if enrichStatus != "" {
		if enrichStatus != leads.EnrichListed && enrichStatus != leads.EnrichEnriched {
			return false, fmt.Errorf("invalid_status")
		}
		sets = append(sets, "enrich_status = ?")
		args = append(args, enrichStatus)
	}
	if aiStatus != "" {
		if aiStatus != leads.AINone && aiStatus != leads.AIPending && aiStatus != leads.AIDone && aiStatus != leads.AISkipped {
			return false, fmt.Errorf("invalid_status")
		}
		sets = append(sets, "ai_status = ?")
		args = append(args, aiStatus)
	}
	if len(sets) == 0 {
		return false, fmt.Errorf("invalid_status")
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id, customerID)
	q := fmt.Sprintf(`UPDATE leads SET %s WHERE id = ? AND create_customer_id = ? AND deleted_at IS NULL`, strings.Join(sets, ", "))
	res, err := s.DB.ExecContext(ctx, s.q(q), args...)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

type ListLeadsOpts struct {
	Limit        int
	Cursor       string
	EnrichStatus string
	AIStatus     string
	Query        string
	Sort         string
}

func encodeCursor(ts time.Time, id string) string {
	raw := fmt.Sprintf("%d|%s", ts.UTC().UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(cursor string) (time.Time, string, error) {
	if cursor == "" {
		return time.Time{}, "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("bad cursor")
	}
	nanos, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, "", err
	}
	return time.Unix(0, nanos).UTC(), parts[1], nil
}

func (s *Store) LeadTotals(ctx context.Context, customerID string) (LeadTotals, error) {
	var t LeadTotals
	err := s.DB.QueryRowContext(ctx, s.q(`
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN enrich_status = 'listed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN enrich_status = 'enriched' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN ai_status = 'none' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN ai_status = 'pending' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN ai_status = 'done' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN ai_status = 'skipped' THEN 1 ELSE 0 END), 0)
		FROM leads
		WHERE create_customer_id = ? AND deleted_at IS NULL
	`), customerID).Scan(&t.All, &t.Listed, &t.Enriched, &t.AINone, &t.AIPending, &t.AIDone, &t.AISkipped)
	return t, err
}

func (s *Store) ListLeads(ctx context.Context, customerID string, opts ListLeadsOpts) (ListLeadsResult, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	totals, err := s.LeadTotals(ctx, customerID)
	if err != nil {
		return ListLeadsResult{}, err
	}

	cursorTime, cursorID, err := decodeCursor(opts.Cursor)
	if err != nil {
		return ListLeadsResult{}, fmt.Errorf("invalid_cursor")
	}

	args := []any{customerID}
	where := []string{"create_customer_id = ?", "deleted_at IS NULL"}

	if opts.EnrichStatus == leads.EnrichListed || opts.EnrichStatus == leads.EnrichEnriched {
		where = append(where, "enrich_status = ?")
		args = append(args, opts.EnrichStatus)
	}
	if opts.AIStatus == leads.AINone || opts.AIStatus == leads.AIPending || opts.AIStatus == leads.AIDone || opts.AIStatus == leads.AISkipped {
		where = append(where, "ai_status = ?")
		args = append(args, opts.AIStatus)
	}
	q := strings.TrimSpace(opts.Query)
	if q != "" {
		like := "%" + q + "%"
		where = append(where, fmt.Sprintf("(%s OR %s OR %s OR %s)",
			s.d.Contains("name"), s.d.Contains("company"), s.d.Contains("title"), s.d.Contains("profile_url")))
		args = append(args, like, like, like, like)
	}

	oldest := strings.EqualFold(strings.TrimSpace(opts.Sort), "oldest")
	orderBy := "updated_at DESC, id DESC"
	sortCol := "updated_at"
	if oldest {
		orderBy = "created_at ASC, id ASC"
		sortCol = "created_at"
	}
	if !cursorTime.IsZero() && cursorID != "" {
		if oldest {
			where = append(where, fmt.Sprintf("(%s, id) > (?, ?)", sortCol))
		} else {
			where = append(where, fmt.Sprintf("(%s, id) < (?, ?)", sortCol))
		}
		args = append(args, cursorTime, cursorID)
	}

	args = append(args, limit+1)
	query := fmt.Sprintf(`
		SELECT id, name, profile_url, COALESCE(linkedin_url, ''), COALESCE(title, ''), COALESCE(company, ''),
			COALESCE(location, ''), COALESCE(email, ''), COALESCE(phone, ''), COALESCE(website, ''),
			COALESCE(headline, ''), COALESCE(about, ''), enrich_status, ai_status, updated_at, created_at
		FROM leads
		WHERE %s
		ORDER BY %s
		LIMIT ?
	`, strings.Join(where, " AND "), orderBy)

	rows, err := s.DB.QueryContext(ctx, s.q(query), args...)
	if err != nil {
		return ListLeadsResult{}, err
	}
	defer rows.Close()

	items := make([]LeadRow, 0, limit)
	for rows.Next() {
		var row LeadRow
		if err := rows.Scan(
			&row.ID, &row.Name, &row.ProfileURL, &row.LinkedInURL, &row.Title, &row.Company,
			&row.Location, &row.Email, &row.Phone, &row.Website, &row.Headline, &row.About,
			&row.EnrichStatus, &row.AIStatus, &row.UpdatedAt, &row.CreatedAt,
		); err != nil {
			return ListLeadsResult{}, err
		}
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return ListLeadsResult{}, err
	}

	var next string
	if len(items) > limit {
		last := items[limit-1]
		if oldest {
			next = encodeCursor(last.CreatedAt, last.ID)
		} else {
			next = encodeCursor(last.UpdatedAt, last.ID)
		}
		items = items[:limit]
	}

	return ListLeadsResult{Items: items, NextCursor: next, Totals: totals}, nil
}
