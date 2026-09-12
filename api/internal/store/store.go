package store

import (
	"context"
	"database/sql"
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
	"github.com/dgmos/linkedin-import/internal/mapping"
)

type Store struct {
	DB *sql.DB
	d  Dialect
	m  mapping.Mapping
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

func New(ctx context.Context, opt Options) (*Store, error) {
	info, err := parseDatabaseURL(opt.DatabaseURL)
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
	m := opt.Mapping
	if m.Leads.Table == "" {
		m = mapping.Default()
	}
	if err := m.Validate(); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{DB: db, d: info.Dialect, m: m}
	if opt.SchemaCheck {
		if err := s.CheckSchema(ctx); err != nil {
			db.Close()
			return nil, err
		}
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

func (s *Store) WorkspaceName(ctx context.Context, id string) (string, error) {
	if !s.m.Workspaces.Enabled() || !s.m.Workspaces.Has("name") {
		return "", sql.ErrNoRows
	}
	var name string
	err := s.DB.QueryRowContext(ctx, s.q(fmt.Sprintf(`SELECT %s FROM %s WHERE %s = ?`, s.wsC("name"), s.wsT(), s.wsC("id"))), id).Scan(&name)
	return name, err
}

func (s *Store) LookupToken(ctx context.Context, hash string) (Principal, error) {
	var p Principal
	selects := []string{s.tokenC("id")}
	if s.m.Tokens.Has("workspace_id") {
		selects = append(selects, s.tokenC("workspace_id"))
	}
	if s.m.Tokens.Has("create_user_id") {
		selects = append(selects, s.tokenC("create_user_id"))
	}
	if s.m.Tokens.Has("create_customer_id") {
		selects = append(selects, s.tokenC("create_customer_id"))
	}
	q := fmt.Sprintf(`SELECT %s FROM %s WHERE %s = ?`, strings.Join(selects, ", "), s.tokenT(), s.tokenC("token_hash"))
	row := s.DB.QueryRowContext(ctx, s.q(q), hash)
	dest := []any{&p.TokenID}
	var workspace, user, customer string
	if s.m.Tokens.Has("workspace_id") {
		dest = append(dest, &workspace)
	}
	if s.m.Tokens.Has("create_user_id") {
		dest = append(dest, &user)
	}
	if s.m.Tokens.Has("create_customer_id") {
		dest = append(dest, &customer)
	}
	if err := row.Scan(dest...); err != nil {
		return Principal{}, err
	}
	p.WorkspaceID = workspace
	p.UserID = firstNonEmpty(user, workspace)
	p.CustomerID = firstNonEmpty(customer, workspace)
	if p.WorkspaceID == "" {
		p.WorkspaceID = p.CustomerID
	}
	return p, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func (s *Store) TouchToken(ctx context.Context, tokenID string) {
	if !s.m.Tokens.Has("last_used_at") {
		return
	}
	_, _ = s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`UPDATE %s SET %s = CURRENT_TIMESTAMP WHERE %s = ?`, s.tokenT(), s.tokenC("last_used_at"), s.tokenC("id"))), tokenID)
}

func (s *Store) ListTokens(ctx context.Context, workspaceID string) ([]TokenRow, error) {
	cols := []string{s.tokenC("id"), s.tokenC("label")}
	hasCreated := s.m.Tokens.Has("created_at")
	hasLast := s.m.Tokens.Has("last_used_at")
	if hasCreated {
		cols = append(cols, s.tokenC("created_at"))
	}
	if hasLast {
		cols = append(cols, s.tokenC("last_used_at"))
	}
	q := fmt.Sprintf(`SELECT %s FROM %s`, strings.Join(cols, ", "), s.tokenT())
	args := []any{}
	if s.m.Tokens.Has("workspace_id") && workspaceID != "" {
		q += fmt.Sprintf(` WHERE %s = ?`, s.tokenC("workspace_id"))
		args = append(args, workspaceID)
	}
	if hasCreated {
		q += fmt.Sprintf(` ORDER BY %s DESC`, s.tokenC("created_at"))
	}
	rows, err := s.DB.QueryContext(ctx, s.q(q), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TokenRow, 0)
	for rows.Next() {
		var t TokenRow
		dest := []any{&t.ID, &t.Label}
		if hasCreated {
			dest = append(dest, &t.CreatedAt)
		}
		var last sql.NullTime
		if hasLast {
			dest = append(dest, &last)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		if last.Valid {
			t.LastUsedAt = &last.Time
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) InsertToken(ctx context.Context, in TokenInsert) (id string, createdAt time.Time, err error) {
	id = uuid.NewString()
	createdAt = time.Now().UTC()
	cols := []string{s.tokenC("id"), s.tokenC("token_hash"), s.tokenC("label")}
	vals := []string{"?", "?", "?"}
	args := []any{id, in.Hash, in.Label}
	if s.m.Tokens.Has("workspace_id") {
		cols = append(cols, s.tokenC("workspace_id"))
		vals = append(vals, "?")
		args = append(args, in.WorkspaceID)
	}
	if s.m.Tokens.Has("create_user_id") {
		cols = append(cols, s.tokenC("create_user_id"))
		vals = append(vals, "?")
		args = append(args, firstNonEmpty(in.UserID, in.WorkspaceID))
	}
	if s.m.Tokens.Has("create_customer_id") {
		cols = append(cols, s.tokenC("create_customer_id"))
		vals = append(vals, "?")
		args = append(args, firstNonEmpty(in.CustomerID, in.WorkspaceID))
	}
	if s.m.Tokens.Has("created_at") {
		cols = append(cols, s.tokenC("created_at"))
		vals = append(vals, "?")
		args = append(args, createdAt)
	}
	_, err = s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, s.tokenT(), strings.Join(cols, ", "), strings.Join(vals, ", "))), args...)
	return
}

func (s *Store) DeleteToken(ctx context.Context, workspaceID, id string) (bool, error) {
	q := fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, s.tokenT(), s.tokenC("id"))
	args := []any{id}
	if s.m.Tokens.Has("workspace_id") && workspaceID != "" {
		q += fmt.Sprintf(` AND %s = ?`, s.tokenC("workspace_id"))
		args = append(args, workspaceID)
	}
	res, err := s.DB.ExecContext(ctx, s.q(q), args...)
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
	err = s.DB.QueryRowContext(ctx, s.q(fmt.Sprintf(`
		SELECT %s, %s FROM %s
		WHERE %s = ? AND %s = ?
	`, s.leadC("id"), s.leadC("enrich_status"), s.leadT(), s.leadC("create_customer_id"), s.leadC("profile_url"))), customerID, lead.ProfileURL).Scan(&existingID, &existingEnrich)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		id := uuid.NewString()
		_, err = s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`
			INSERT INTO %s (
				%s, %s, %s, %s, %s, %s, %s, %s, %s,
				%s, %s, %s, %s, %s, %s, %s, %s
			) VALUES (
				?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
				NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
				?, ?, ?
			)
		`, s.leadT(),
			s.leadC("id"), s.leadC("create_user_id"), s.leadC("create_customer_id"), s.leadC("name"), s.leadC("profile_url"),
			s.leadC("linkedin_url"), s.leadC("title"), s.leadC("company"), s.leadC("location"),
			s.leadC("email"), s.leadC("phone"), s.leadC("website"), s.leadC("headline"), s.leadC("about"),
			s.leadC("enrich_status"), s.leadC("ai_status"), s.leadC("metadata"),
		)), id, userID, customerID, lead.Name, lead.ProfileURL, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
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

	res, err := s.DB.ExecContext(ctx, s.q(s.leadUpdateSQL(false)),
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
	res, err := s.DB.ExecContext(ctx, s.q(s.leadUpdateSQL(true)),
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
		sets = append(sets, s.leadC("enrich_status")+" = ?")
		args = append(args, enrichStatus)
	}
	if aiStatus != "" {
		if aiStatus != leads.AINone && aiStatus != leads.AIPending && aiStatus != leads.AIDone && aiStatus != leads.AISkipped {
			return false, fmt.Errorf("invalid_status")
		}
		sets = append(sets, s.leadC("ai_status")+" = ?")
		args = append(args, aiStatus)
	}
	if len(sets) == 0 {
		return false, fmt.Errorf("invalid_status")
	}
	sets = append(sets, s.leadC("updated_at")+" = CURRENT_TIMESTAMP")
	args = append(args, id, customerID)
	q := fmt.Sprintf(`UPDATE %s SET %s WHERE %s = ? AND %s = ? AND %s`, s.leadT(), strings.Join(sets, ", "), s.leadC("id"), s.leadC("create_customer_id"), s.leadDeletedClause())
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
	err := s.DB.QueryRowContext(ctx, s.q(fmt.Sprintf(`
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN %s = 'listed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN %s = 'enriched' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN %s = 'none' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN %s = 'pending' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN %s = 'done' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN %s = 'skipped' THEN 1 ELSE 0 END), 0)
		FROM %s
		WHERE %s = ? AND %s
	`, s.leadC("enrich_status"), s.leadC("enrich_status"),
		s.leadC("ai_status"), s.leadC("ai_status"), s.leadC("ai_status"), s.leadC("ai_status"),
		s.leadT(), s.leadC("create_customer_id"), s.leadDeletedClause(),
	)), customerID).Scan(&t.All, &t.Listed, &t.Enriched, &t.AINone, &t.AIPending, &t.AIDone, &t.AISkipped)
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
	where := []string{s.leadC("create_customer_id") + " = ?", s.leadDeletedClause()}

	if opts.EnrichStatus == leads.EnrichListed || opts.EnrichStatus == leads.EnrichEnriched {
		where = append(where, s.leadC("enrich_status")+" = ?")
		args = append(args, opts.EnrichStatus)
	}
	if opts.AIStatus == leads.AINone || opts.AIStatus == leads.AIPending || opts.AIStatus == leads.AIDone || opts.AIStatus == leads.AISkipped {
		where = append(where, s.leadC("ai_status")+" = ?")
		args = append(args, opts.AIStatus)
	}
	q := strings.TrimSpace(opts.Query)
	if q != "" {
		like := "%" + q + "%"
		where = append(where, fmt.Sprintf("(%s OR %s OR %s OR %s)",
			s.d.Contains(s.leadC("name")), s.d.Contains(s.leadC("company")), s.d.Contains(s.leadC("title")), s.d.Contains(s.leadC("profile_url"))))
		args = append(args, like, like, like, like)
	}

	oldest := strings.EqualFold(strings.TrimSpace(opts.Sort), "oldest")
	orderBy := fmt.Sprintf("%s DESC, %s DESC", s.leadC("updated_at"), s.leadC("id"))
	sortCol := s.leadC("updated_at")
	if oldest {
		orderBy = fmt.Sprintf("%s ASC, %s ASC", s.leadC("created_at"), s.leadC("id"))
		sortCol = s.leadC("created_at")
	}
	if !cursorTime.IsZero() && cursorID != "" {
		if oldest {
			where = append(where, fmt.Sprintf("(%s, %s) > (?, ?)", sortCol, s.leadC("id")))
		} else {
			where = append(where, fmt.Sprintf("(%s, %s) < (?, ?)", sortCol, s.leadC("id")))
		}
		args = append(args, cursorTime, cursorID)
	}

	args = append(args, limit+1)
	query := fmt.Sprintf(`
		SELECT %s, %s, %s, COALESCE(%s, ''), COALESCE(%s, ''), COALESCE(%s, ''),
			COALESCE(%s, ''), COALESCE(%s, ''), COALESCE(%s, ''), COALESCE(%s, ''),
			COALESCE(%s, ''), COALESCE(%s, ''), %s, %s, %s, %s
		FROM %s
		WHERE %s
		ORDER BY %s
		LIMIT ?
	`, s.leadC("id"), s.leadC("name"), s.leadC("profile_url"), s.leadC("linkedin_url"), s.leadC("title"), s.leadC("company"),
		s.leadC("location"), s.leadC("email"), s.leadC("phone"), s.leadC("website"),
		s.leadC("headline"), s.leadC("about"), s.leadC("enrich_status"), s.leadC("ai_status"), s.leadC("updated_at"), s.leadC("created_at"),
		s.leadT(), strings.Join(where, " AND "), orderBy)

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
