package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dgmos/linkedin-import/internal/mapping"
)

type Options struct {
	DatabaseURL string
	Mapping     mapping.Mapping
	SchemaCheck bool
}

type Principal struct {
	TokenID     string
	WorkspaceID string
	UserID      string
	CustomerID  string
}

type TokenInsert struct {
	WorkspaceID string
	UserID      string
	CustomerID  string
	Hash        string
	Label       string
}

func (s *Store) leadT() string {
	return s.d.Qualify(s.m.Leads.SchemaOr(s.m.Schema), s.m.Leads.Table)
}

func (s *Store) leadC(logical string) string {
	return s.d.Quote(s.m.Leads.Col(logical))
}

func (s *Store) tokenT() string {
	return s.d.Qualify(s.m.Tokens.SchemaOr(s.m.Schema), s.m.Tokens.Table)
}

func (s *Store) tokenC(logical string) string {
	return s.d.Quote(s.m.Tokens.Col(logical))
}

func (s *Store) wsT() string {
	return s.d.Qualify(s.m.Workspaces.SchemaOr(s.m.Schema), s.m.Workspaces.Table)
}

func (s *Store) wsC(logical string) string {
	return s.d.Quote(s.m.Workspaces.Col(logical))
}

func (s *Store) leadUpdateSQL(mysql bool) string {
	c := func(logical string) string { return s.leadC(logical) }
	changed := func(col string) string {
		if mysql {
			return fmt.Sprintf("(? <> '' AND NOT %s <=> ?)", col)
		}
		return fmt.Sprintf("(? <> '' AND %s IS DISTINCT FROM ?)", col)
	}
	enrichChanged := fmt.Sprintf("(? = 'enriched' AND %s IS DISTINCT FROM 'enriched')", c("enrich_status"))
	aiChanged := fmt.Sprintf("(? <> '' AND ? <> 'none' AND %s IS DISTINCT FROM ?)", c("ai_status"))
	if mysql {
		enrichChanged = fmt.Sprintf("(? = 'enriched' AND NOT %s <=> 'enriched')", c("enrich_status"))
		aiChanged = fmt.Sprintf("(? <> '' AND ? <> 'none' AND NOT %s <=> ?)", c("ai_status"))
	}
	deletedClear, deletedPred := s.leadUndeleteSQL()
	return fmt.Sprintf(`
		UPDATE %s SET
			%s = CASE WHEN ? <> '' THEN ? ELSE %s END,
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = COALESCE(NULLIF(?, ''), %s),
			%s = CASE WHEN ? = 'enriched' THEN 'enriched' ELSE %s END,
			%s = CASE WHEN ? <> '' AND ? <> 'none' THEN ? ELSE %s END,
			%s,
			%s
			%s = %s
		WHERE %s = ? AND %s = ?
		  AND (
			%s OR %s OR %s OR %s OR %s OR %s OR %s OR %s OR %s OR %s
			OR %s OR %s OR %s
		  )
	`,
		s.leadT(),
		c("name"), c("name"),
		c("linkedin_url"), c("linkedin_url"),
		c("title"), c("title"),
		c("company"), c("company"),
		c("location"), c("location"),
		c("email"), c("email"),
		c("phone"), c("phone"),
		c("website"), c("website"),
		c("headline"), c("headline"),
		c("about"), c("about"),
		c("enrich_status"), c("enrich_status"),
		c("ai_status"), c("ai_status"),
		s.d.MergeJSON(c("metadata")),
		deletedClear,
		c("updated_at"), s.nowExpr(),
		c("id"), c("create_customer_id"),
		changed(c("name")), changed(c("linkedin_url")), changed(c("title")), changed(c("company")),
		changed(c("location")), changed(c("email")), changed(c("phone")), changed(c("website")),
		changed(c("headline")), changed(c("about")),
		enrichChanged, aiChanged, deletedPred,
	)
}

func (s *Store) leadDeletedClause() string {
	return s.leadC("deleted_at") + " IS NULL"
}

func (s *Store) leadUndeleteSQL() (set, pred string) {
	return s.leadC("deleted_at") + " = NULL,", s.leadC("deleted_at") + " IS NOT NULL"
}

func (s *Store) nowExpr() string {
	if s.d == DialectMySQL {
		return "UNIX_TIMESTAMP()"
	}
	return "EXTRACT(EPOCH FROM CLOCK_TIMESTAMP())::bigint"
}

func (s *Store) timeArg(t time.Time) any {
	return t.Unix()
}

func (s *Store) CheckSchema(ctx context.Context) error {
	checks := []mapping.Table{s.m.Leads}
	if s.m.Auth.Mode == "" || s.m.AuthMode() == "token_table" {
		checks = append(checks, s.m.Tokens)
	}
	if s.m.Workspaces.Enabled() {
		checks = append(checks, s.m.Workspaces)
	}
	for _, table := range checks {
		if !table.Enabled() {
			continue
		}
		have, err := s.listColumns(ctx, table.SchemaOr(s.m.Schema), table.Table)
		if err != nil {
			return fmt.Errorf("schema check %s: %w", table.Table, err)
		}
		for logical, physical := range table.Columns {
			if physical == "" {
				continue
			}
			if !have[strings.ToLower(physical)] {
				return fmt.Errorf("mapped column %s.%s (%s) is missing on host table %s", table.Table, logical, physical, table.Table)
			}
		}
	}
	return nil
}

func (s *Store) listColumns(ctx context.Context, schema, table string) (map[string]bool, error) {
	q := `
		SELECT column_name FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ?
	`
	args := []any{table}
	if s.d == DialectPostgres {
		schemaExpr := "current_schema()"
		if strings.TrimSpace(schema) != "" {
			q = `
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = ? AND table_name = ?
			`
			args = []any{schema, table}
		} else {
			q = `
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = ` + schemaExpr + ` AND table_name = ?
			`
			args = []any{table}
		}
	} else if strings.TrimSpace(schema) != "" {
		q = `
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ?
		`
		args = []any{schema, table}
	}

	rows, err := s.DB.QueryContext(ctx, s.q(q), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[strings.ToLower(name)] = true
	}
	return out, rows.Err()
}
