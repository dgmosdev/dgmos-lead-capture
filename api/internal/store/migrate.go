package store

import (
	"context"
	"fmt"
)

// EnsureSchema creates leads + extension_tokens when missing.
// IF NOT EXISTS only — never ALTER host tables.
func (s *Store) EnsureSchema(ctx context.Context) error {
	stmts, err := s.createTableSQL()
	if err != nil {
		return err
	}
	for _, q := range stmts {
		if _, err := s.DB.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("auto migrate: %w", err)
		}
	}
	return nil
}

func (s *Store) createTableSQL() ([]string, error) {
	required := []string{
		"id", "create_user_id", "create_customer_id", "name", "profile_url",
		"linkedin_url", "title", "company", "location", "email", "phone",
		"website", "headline", "about", "enrich_status", "ai_status",
		"metadata", "created_at", "updated_at", "deleted_at",
	}
	for _, col := range required {
		if !s.m.Leads.Has(col) {
			return nil, fmt.Errorf("auto migrate: leads.%s not mapped", col)
		}
	}
	tokenReq := []string{"id", "token_hash", "label", "created_at", "create_user_id", "create_customer_id", "last_used_at"}
	for _, col := range tokenReq {
		if !s.m.Tokens.Has(col) {
			return nil, fmt.Errorf("auto migrate: tokens.%s not mapped", col)
		}
	}

	lc := func(logical string) string { return s.leadC(logical) }
	tc := func(logical string) string { return s.tokenC(logical) }
	leadT := s.leadT()
	tokenT := s.tokenT()

	if s.d == DialectMySQL {
		return []string{
			fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  %s BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s VARCHAR(255) NOT NULL,
  %s VARCHAR(255) NULL,
  %s VARCHAR(255) NULL,
  %s VARCHAR(255) NULL,
  %s VARCHAR(255) NULL,
  %s VARCHAR(64) NULL,
  %s VARCHAR(500) NULL,
  %s VARCHAR(512) NULL,
  %s TEXT NULL,
  %s VARCHAR(500) NOT NULL,
  %s VARCHAR(500) NULL,
  %s ENUM('listed', 'enriched') NOT NULL DEFAULT 'listed',
  %s ENUM('none', 'pending', 'done', 'skipped') NOT NULL DEFAULT 'none',
  %s JSON NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NULL,
  PRIMARY KEY (%s),
  UNIQUE KEY uq_customer_profile (%s, %s),
  KEY idx_customer_updated (%s, %s)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci`,
				leadT,
				lc("id"), lc("create_user_id"), lc("create_customer_id"), lc("name"),
				lc("title"), lc("company"), lc("location"), lc("email"), lc("phone"),
				lc("website"), lc("headline"), lc("about"), lc("profile_url"), lc("linkedin_url"),
				lc("enrich_status"), lc("ai_status"), lc("metadata"),
				lc("created_at"), lc("updated_at"), lc("deleted_at"),
				lc("id"), lc("create_customer_id"), lc("profile_url"),
				lc("create_customer_id"), lc("updated_at"),
			),
			fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  %s BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  %s CHAR(64) NOT NULL,
  %s VARCHAR(255) NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NULL,
  PRIMARY KEY (%s),
  UNIQUE KEY uq_token_hash (%s),
  KEY idx_token_customer (%s)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci`,
				tokenT,
				tc("id"), tc("token_hash"), tc("label"),
				tc("create_user_id"), tc("create_customer_id"), tc("created_at"), tc("last_used_at"),
				tc("id"), tc("token_hash"), tc("create_customer_id"),
			),
		}, nil
	}

	return []string{
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  %s BIGSERIAL PRIMARY KEY,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s TEXT NOT NULL,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT,
  %s TEXT NOT NULL,
  %s TEXT,
  %s TEXT NOT NULL DEFAULT 'listed',
  %s TEXT NOT NULL DEFAULT 'none',
  %s JSONB,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT,
  UNIQUE (%s, %s)
)`,
			leadT,
			lc("id"), lc("create_user_id"), lc("create_customer_id"), lc("name"),
			lc("title"), lc("company"), lc("location"), lc("email"), lc("phone"),
			lc("website"), lc("headline"), lc("about"), lc("profile_url"), lc("linkedin_url"),
			lc("enrich_status"), lc("ai_status"), lc("metadata"),
			lc("created_at"), lc("updated_at"), lc("deleted_at"),
			lc("create_customer_id"), lc("profile_url"),
		),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  %s BIGSERIAL PRIMARY KEY,
  %s CHAR(64) NOT NULL UNIQUE,
  %s TEXT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT NOT NULL,
  %s BIGINT
)`,
			tokenT,
			tc("id"), tc("token_hash"), tc("label"),
			tc("create_user_id"), tc("create_customer_id"), tc("created_at"), tc("last_used_at"),
		),
	}, nil
}
