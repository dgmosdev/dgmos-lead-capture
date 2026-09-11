package store

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/dgmos/linkedin-import/internal/leads"
)

//go:embed schema.sql
var schemaSQL string

type Store struct {
	Pool *pgxpool.Pool
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
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	s := &Store{Pool: pool}
	if err := s.Migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() {
	s.Pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.Pool.Ping(ctx)
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		return fmt.Errorf("schema_migrations: %w", err)
	}

	if err := s.applyMigration(ctx, "001_init", schemaSQL); err != nil {
		return err
	}
	if err := s.applyMigration(ctx, "002_lead_status", `
		ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrich_status TEXT NOT NULL DEFAULT 'listed';
		ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'none';
		UPDATE leads SET enrich_status = 'enriched'
		WHERE enrich_status = 'listed'
		  AND (
			NULLIF(about, '') IS NOT NULL
			OR NULLIF(email, '') IS NOT NULL
			OR NULLIF(phone, '') IS NOT NULL
			OR (profile_url ILIKE '%/company/%' AND NULLIF(website, '') IS NOT NULL)
		  );
		CREATE INDEX IF NOT EXISTS idx_leads_enrich ON leads(workspace_id, enrich_status);
		CREATE INDEX IF NOT EXISTS idx_leads_ai ON leads(workspace_id, ai_status);
	`); err != nil {
		return err
	}
	return nil
}

func (s *Store) applyMigration(ctx context.Context, version, sql string) error {
	var applied bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied)
	if err != nil {
		return err
	}
	if applied {
		return nil
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, sql); err != nil {
		return fmt.Errorf("apply %s: %w", version, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) EnsureWorkspace(ctx context.Context, id, name string) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO workspaces (id, name)
		VALUES ($1::uuid, $2)
		ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
	`, id, name)
	return err
}

func (s *Store) WorkspaceName(ctx context.Context, id string) (string, error) {
	var name string
	err := s.Pool.QueryRow(ctx, `SELECT name FROM workspaces WHERE id = $1::uuid`, id).Scan(&name)
	return name, err
}

func (s *Store) LookupToken(ctx context.Context, hash string) (workspaceID, tokenID string, err error) {
	err = s.Pool.QueryRow(ctx, `
		SELECT workspace_id::text, id::text
		FROM extension_tokens
		WHERE token_hash = $1
	`, hash).Scan(&workspaceID, &tokenID)
	return
}

func (s *Store) TouchToken(ctx context.Context, tokenID string) {
	_, _ = s.Pool.Exec(ctx, `UPDATE extension_tokens SET last_used_at = now() WHERE id = $1::uuid`, tokenID)
}

func (s *Store) ListTokens(ctx context.Context, workspaceID string) ([]TokenRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id::text, label, created_at, last_used_at
		FROM extension_tokens
		WHERE workspace_id = $1::uuid
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TokenRow, 0)
	for rows.Next() {
		var t TokenRow
		if err := rows.Scan(&t.ID, &t.Label, &t.CreatedAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) InsertToken(ctx context.Context, workspaceID, hash, label string) (id string, createdAt time.Time, err error) {
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO extension_tokens (workspace_id, token_hash, label)
		VALUES ($1::uuid, $2, $3)
		RETURNING id::text, created_at
	`, workspaceID, hash, label).Scan(&id, &createdAt)
	return
}

func (s *Store) DeleteToken(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM extension_tokens WHERE workspace_id = $1::uuid AND id = $2::uuid
	`, workspaceID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpsertLead(ctx context.Context, workspaceID string, lead leads.Lead, pageURL string) (created, merged bool, err error) {
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
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, enrich_status FROM leads WHERE workspace_id = $1::uuid AND profile_url = $2
	`, workspaceID, lead.ProfileURL).Scan(&existingID, &existingEnrich)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		_, err = s.Pool.Exec(ctx, `
			INSERT INTO leads (
				workspace_id, name, profile_url, linkedin_url, title, company, location,
				email, phone, website, headline, about, enrich_status, ai_status, metadata
			) VALUES (
				$1::uuid, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''),
				NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''),
				$13, $14, $15::jsonb
			)
		`, workspaceID, lead.Name, lead.ProfileURL, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
			lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus, aiStatus, meta)
		if err != nil {
			return false, false, err
		}
		return true, false, nil
	}

	if existingEnrich == leads.EnrichEnriched {
		enrichStatus = leads.EnrichEnriched
	}

	tag, err := s.Pool.Exec(ctx, `
		UPDATE leads SET
			name = CASE WHEN $3 <> '' THEN $3 ELSE name END,
			linkedin_url = COALESCE(NULLIF($4, ''), linkedin_url),
			title = COALESCE(NULLIF($5, ''), title),
			company = COALESCE(NULLIF($6, ''), company),
			location = COALESCE(NULLIF($7, ''), location),
			email = COALESCE(NULLIF($8, ''), email),
			phone = COALESCE(NULLIF($9, ''), phone),
			website = COALESCE(NULLIF($10, ''), website),
			headline = COALESCE(NULLIF($11, ''), headline),
			about = COALESCE(NULLIF($12, ''), about),
			enrich_status = CASE
				WHEN $13 = 'enriched' THEN 'enriched'
				ELSE enrich_status
			END,
			ai_status = CASE
				WHEN $14 <> '' AND $14 <> 'none' THEN $14
				ELSE ai_status
			END,
			metadata = COALESCE(metadata, '{}'::jsonb) || $15::jsonb,
			updated_at = now()
		WHERE id = $1::uuid AND workspace_id = $2::uuid
		  AND (
			($3 <> '' AND name IS DISTINCT FROM $3)
			OR ($4 <> '' AND linkedin_url IS DISTINCT FROM $4)
			OR ($5 <> '' AND title IS DISTINCT FROM $5)
			OR ($6 <> '' AND company IS DISTINCT FROM $6)
			OR ($7 <> '' AND location IS DISTINCT FROM $7)
			OR ($8 <> '' AND email IS DISTINCT FROM $8)
			OR ($9 <> '' AND phone IS DISTINCT FROM $9)
			OR ($10 <> '' AND website IS DISTINCT FROM $10)
			OR ($11 <> '' AND headline IS DISTINCT FROM $11)
			OR ($12 <> '' AND about IS DISTINCT FROM $12)
			OR ($13 = 'enriched' AND enrich_status IS DISTINCT FROM 'enriched')
			OR ($14 <> '' AND $14 <> 'none' AND ai_status IS DISTINCT FROM $14)
		  )
	`, existingID, workspaceID, lead.Name, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus, aiStatus, meta)
	if err != nil {
		return false, false, err
	}
	if tag.RowsAffected() > 0 {
		return false, true, nil
	}
	return false, false, nil
}

func (s *Store) UpdateLeadStatus(ctx context.Context, workspaceID, id, enrichStatus, aiStatus string) (bool, error) {
	sets := make([]string, 0, 3)
	args := []any{id, workspaceID}
	n := 3
	if enrichStatus != "" {
		if enrichStatus != leads.EnrichListed && enrichStatus != leads.EnrichEnriched {
			return false, fmt.Errorf("invalid_status")
		}
		sets = append(sets, fmt.Sprintf("enrich_status = $%d", n))
		args = append(args, enrichStatus)
		n++
	}
	if aiStatus != "" {
		if aiStatus != leads.AINone && aiStatus != leads.AIPending && aiStatus != leads.AIDone && aiStatus != leads.AISkipped {
			return false, fmt.Errorf("invalid_status")
		}
		sets = append(sets, fmt.Sprintf("ai_status = $%d", n))
		args = append(args, aiStatus)
		n++
	}
	if len(sets) == 0 {
		return false, fmt.Errorf("invalid_status")
	}
	sets = append(sets, "updated_at = now()")
	sql := fmt.Sprintf(`UPDATE leads SET %s WHERE id = $1::uuid AND workspace_id = $2::uuid`, strings.Join(sets, ", "))
	tag, err := s.Pool.Exec(ctx, sql, args...)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

type ListLeadsOpts struct {
	Limit        int
	Cursor       string
	EnrichStatus string
	AIStatus     string
	Query        string
}

func encodeCursor(updatedAt time.Time, id string) string {
	raw := fmt.Sprintf("%d|%s", updatedAt.UTC().UnixNano(), id)
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

func (s *Store) LeadTotals(ctx context.Context, workspaceID string) (LeadTotals, error) {
	var t LeadTotals
	err := s.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE enrich_status = 'listed')::int,
			COUNT(*) FILTER (WHERE enrich_status = 'enriched')::int,
			COUNT(*) FILTER (WHERE ai_status = 'none')::int,
			COUNT(*) FILTER (WHERE ai_status = 'pending')::int,
			COUNT(*) FILTER (WHERE ai_status = 'done')::int,
			COUNT(*) FILTER (WHERE ai_status = 'skipped')::int
		FROM leads
		WHERE workspace_id = $1::uuid
	`, workspaceID).Scan(&t.All, &t.Listed, &t.Enriched, &t.AINone, &t.AIPending, &t.AIDone, &t.AISkipped)
	return t, err
}

func (s *Store) ListLeads(ctx context.Context, workspaceID string, opts ListLeadsOpts) (ListLeadsResult, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	totals, err := s.LeadTotals(ctx, workspaceID)
	if err != nil {
		return ListLeadsResult{}, err
	}

	cursorTime, cursorID, err := decodeCursor(opts.Cursor)
	if err != nil {
		return ListLeadsResult{}, fmt.Errorf("invalid_cursor")
	}

	args := []any{workspaceID}
	where := []string{"workspace_id = $1::uuid"}
	argN := 2

	if opts.EnrichStatus == leads.EnrichListed || opts.EnrichStatus == leads.EnrichEnriched {
		where = append(where, fmt.Sprintf("enrich_status = $%d", argN))
		args = append(args, opts.EnrichStatus)
		argN++
	}
	if opts.AIStatus == leads.AINone || opts.AIStatus == leads.AIPending || opts.AIStatus == leads.AIDone || opts.AIStatus == leads.AISkipped {
		where = append(where, fmt.Sprintf("ai_status = $%d", argN))
		args = append(args, opts.AIStatus)
		argN++
	}
	q := strings.TrimSpace(opts.Query)
	if q != "" {
		where = append(where, fmt.Sprintf("(name ILIKE $%d OR company ILIKE $%d OR title ILIKE $%d OR profile_url ILIKE $%d)", argN, argN, argN, argN))
		args = append(args, "%"+q+"%")
		argN++
	}
	if !cursorTime.IsZero() && cursorID != "" {
		where = append(where, fmt.Sprintf("(updated_at, id) < ($%d::timestamptz, $%d::uuid)", argN, argN+1))
		args = append(args, cursorTime, cursorID)
		argN += 2
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT id::text, name, profile_url, COALESCE(linkedin_url, ''), COALESCE(title, ''), COALESCE(company, ''),
			COALESCE(location, ''), COALESCE(email, ''), COALESCE(phone, ''), COALESCE(website, ''),
			COALESCE(headline, ''), COALESCE(about, ''), enrich_status, ai_status, updated_at, created_at
		FROM leads
		WHERE %s
		ORDER BY updated_at DESC, id DESC
		LIMIT $%d
	`, strings.Join(where, " AND "), argN)

	rows, err := s.Pool.Query(ctx, sql, args...)
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
		next = encodeCursor(last.UpdatedAt, last.ID)
		items = items[:limit]
	}

	return ListLeadsResult{Items: items, NextCursor: next, Totals: totals}, nil
}
