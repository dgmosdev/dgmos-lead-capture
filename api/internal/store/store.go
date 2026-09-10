package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
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

	var applied bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, "001_init").Scan(&applied)
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

	if _, err := tx.Exec(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, "001_init"); err != nil {
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

	var existingID string
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text FROM leads WHERE workspace_id = $1::uuid AND profile_url = $2
	`, workspaceID, lead.ProfileURL).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		_, err = s.Pool.Exec(ctx, `
			INSERT INTO leads (
				workspace_id, name, profile_url, linkedin_url, title, company, location,
				email, phone, website, headline, about, metadata
			) VALUES (
				$1::uuid, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''),
				NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13::jsonb
			)
		`, workspaceID, lead.Name, lead.ProfileURL, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
			lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, meta)
		if err != nil {
			return false, false, err
		}
		return true, false, nil
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
			metadata = COALESCE(metadata, '{}'::jsonb) || $13::jsonb,
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
		  )
	`, existingID, workspaceID, lead.Name, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, meta)
	if err != nil {
		return false, false, err
	}
	if tag.RowsAffected() > 0 {
		return false, true, nil
	}
	return false, false, nil
}
