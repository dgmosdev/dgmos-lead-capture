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
	if opt.AutoMigrate {
		if err := s.EnsureSchema(ctx); err != nil {
			db.Close()
			return nil, err
		}
	}
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

func (s *Store) LookupToken(ctx context.Context, hash string) (Principal, error) {
	var p Principal
	selects := []string{s.tokenC("id"), s.tokenC("create_customer_id")}
	hasUser := s.m.Tokens.Has("create_user_id")
	if hasUser {
		selects = append(selects, s.tokenC("create_user_id"))
	}
	q := fmt.Sprintf(`SELECT %s FROM %s WHERE %s = ?`, strings.Join(selects, ", "), s.tokenT(), s.tokenC("token_hash"))
	var tokenID, customer, user flexID
	dest := []any{&tokenID, &customer}
	if hasUser {
		dest = append(dest, &user)
	}
	if err := s.DB.QueryRowContext(ctx, s.q(q), hash).Scan(dest...); err != nil {
		return Principal{}, err
	}
	p.TokenID = string(tokenID)
	p.CustomerID = string(customer)
	p.UserID = string(user)
	if p.UserID == "" {
		p.UserID = p.CustomerID
	}
	return p, nil
}

func (s *Store) TouchToken(ctx context.Context, tokenID string) {
	if !s.m.Tokens.Has("last_used_at") {
		return
	}
	_, _ = s.DB.ExecContext(ctx, s.q(fmt.Sprintf(`UPDATE %s SET %s = %s WHERE %s = ?`, s.tokenT(), s.tokenC("last_used_at"), s.nowExpr(), s.tokenC("id"))), tokenID)
}

func (s *Store) ListTokens(ctx context.Context) ([]TokenRow, error) {
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
	if hasCreated {
		q += fmt.Sprintf(` ORDER BY %s DESC`, s.tokenC("created_at"))
	}
	rows, err := s.DB.QueryContext(ctx, s.q(q))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TokenRow, 0)
	for rows.Next() {
		var t TokenRow
		var id flexID
		var created, last flexTime
		dest := []any{&id, &t.Label}
		if hasCreated {
			dest = append(dest, &created)
		}
		if hasLast {
			dest = append(dest, &last)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		t.ID = string(id)
		t.CreatedAt = created.t
		if !last.t.IsZero() {
			t.LastUsedAt = &last.t
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) InsertToken(ctx context.Context, in TokenInsert) (id string, createdAt time.Time, err error) {
	createdAt = time.Now().UTC()
	cols := []string{s.tokenC("token_hash"), s.tokenC("label")}
	vals := []string{"?", "?"}
	args := []any{in.Hash, in.Label}
	if s.m.Tokens.Has("create_user_id") {
		cols = append(cols, s.tokenC("create_user_id"))
		vals = append(vals, "?")
		args = append(args, in.UserID)
	}
	if s.m.Tokens.Has("create_customer_id") {
		cols = append(cols, s.tokenC("create_customer_id"))
		vals = append(vals, "?")
		args = append(args, in.CustomerID)
	}
	if s.m.Tokens.Has("created_at") {
		cols = append(cols, s.tokenC("created_at"))
		vals = append(vals, s.nowExpr())
	}
	q := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, s.tokenT(), strings.Join(cols, ", "), strings.Join(vals, ", "))
	id, err = s.execInsert(ctx, q, s.tokenC("id"), args...)
	return id, createdAt, err
}

func (s *Store) DeleteToken(ctx context.Context, id string) (bool, error) {
	q := fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, s.tokenT(), s.tokenC("id"))
	res, err := s.DB.ExecContext(ctx, s.q(q), id)
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

	var existingID flexID
	var existingEnrich string
	err = s.DB.QueryRowContext(ctx, s.q(fmt.Sprintf(`
		SELECT %s, %s FROM %s
		WHERE %s = ? AND %s = ?
	`, s.leadC("id"), s.leadC("enrich_status"), s.leadT(), s.leadC("create_customer_id"), s.leadC("profile_url"))), customerID, lead.ProfileURL).Scan(&existingID, &existingEnrich)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		if _, err = s.insertLead(ctx, userID, customerID, lead, enrichStatus, aiStatus, meta); err != nil {
			return false, false, err
		}
		return true, false, nil
	}

	if existingEnrich == leads.EnrichEnriched {
		enrichStatus = leads.EnrichEnriched
	}
	if s.d == DialectMySQL {
		return s.upsertLeadMySQL(ctx, string(existingID), customerID, lead, enrichStatus, aiStatus, meta)
	}

	res, err := s.DB.ExecContext(ctx, s.q(s.leadUpdateSQL(false)),
		lead.Name, lead.Name, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, enrichStatus,
		aiStatus, aiStatus, aiStatus, meta, string(existingID), customerID,
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

func (s *Store) insertLead(ctx context.Context, userID, customerID string, lead leads.Lead, enrichStatus, aiStatus, meta string) (string, error) {
	cols := []string{s.leadC("create_customer_id"), s.leadC("name"), s.leadC("profile_url")}
	vals := []string{"?", "?", "?"}
	args := []any{customerID, lead.Name, lead.ProfileURL}
	if s.m.Leads.Has("create_user_id") {
		cols = append([]string{s.leadC("create_user_id")}, cols...)
		vals = append([]string{"?"}, vals...)
		args = append([]any{userID}, args...)
	}

	optional := []struct {
		logical string
		value   string
	}{
		{"linkedin_url", lead.LinkedInURL},
		{"title", lead.Title},
		{"company", lead.Company},
		{"location", lead.Location},
		{"email", lead.Email},
		{"phone", lead.Phone},
		{"website", lead.Website},
		{"headline", lead.Headline},
		{"about", lead.About},
	}
	for _, col := range optional {
		if !s.m.Leads.Has(col.logical) {
			continue
		}
		cols = append(cols, s.leadC(col.logical))
		vals = append(vals, "NULLIF(?, '')")
		args = append(args, col.value)
	}
	if s.m.Leads.Has("enrich_status") {
		cols = append(cols, s.leadC("enrich_status"))
		vals = append(vals, "?")
		args = append(args, enrichStatus)
	}
	if s.m.Leads.Has("ai_status") {
		cols = append(cols, s.leadC("ai_status"))
		vals = append(vals, "?")
		args = append(args, aiStatus)
	}
	if s.m.Leads.Has("metadata") {
		cols = append(cols, s.leadC("metadata"))
		vals = append(vals, "?")
		args = append(args, meta)
	}
	if s.m.Leads.Has("created_at") {
		cols = append(cols, s.leadC("created_at"))
		vals = append(vals, s.nowExpr())
	}
	if s.m.Leads.Has("updated_at") {
		cols = append(cols, s.leadC("updated_at"))
		vals = append(vals, s.nowExpr())
	}
	q := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, s.leadT(), strings.Join(cols, ", "), strings.Join(vals, ", "))
	return s.execInsert(ctx, q, s.leadC("id"), args...)
}

func (s *Store) execInsert(ctx context.Context, query, returningCol string, args ...any) (string, error) {
	if s.d == DialectPostgres {
		var id flexID
		err := s.DB.QueryRowContext(ctx, s.q(query+" RETURNING "+returningCol), args...).Scan(&id)
		return string(id), err
	}
	res, err := s.DB.ExecContext(ctx, s.q(query), args...)
	if err != nil {
		return "", err
	}
	lid, err := res.LastInsertId()
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(lid, 10), nil
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
	sets = append(sets, s.leadC("updated_at")+" = "+s.nowExpr())
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
		args = append(args, s.timeArg(cursorTime), cursorID)
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
		var id flexID
		var updated, created flexTime
		if err := rows.Scan(
			&id, &row.Name, &row.ProfileURL, &row.LinkedInURL, &row.Title, &row.Company,
			&row.Location, &row.Email, &row.Phone, &row.Website, &row.Headline, &row.About,
			&row.EnrichStatus, &row.AIStatus, &updated, &created,
		); err != nil {
			return ListLeadsResult{}, err
		}
		row.ID = string(id)
		row.UpdatedAt = updated.t
		row.CreatedAt = created.t
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
