package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const tokenPrefix = "dgext_"

type Config struct {
	DatabaseURL   string
	HTTPAddr      string
	AdminKey      string
	WorkspaceID   string
	WorkspaceName string
	CORSOrigin    string
}

func loadConfig() Config {
	return Config{
		DatabaseURL:   env("DATABASE_URL", "postgres://dgmos:dgmos@localhost:5433/dgmos_leads?sslmode=disable"),
		HTTPAddr:      env("HTTP_ADDR", ":8088"),
		AdminKey:      env("ADMIN_KEY", "change-me-admin-key"),
		WorkspaceID:   env("WORKSPACE_ID", "11111111-1111-1111-1111-111111111111"),
		WorkspaceName: env("WORKSPACE_NAME", "Dgmos"),
		CORSOrigin:    env("CORS_ORIGIN", "*"),
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

type Server struct {
	cfg  Config
	pool *pgxpool.Pool
}

type ExtensionLead struct {
	Name        string `json:"name"`
	ProfileURL  string `json:"profile_url"`
	LinkedInURL string `json:"linkedin_url"`
	Title       string `json:"title"`
	Company     string `json:"company"`
	Location    string `json:"location"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Website     string `json:"website"`
	Headline    string `json:"headline"`
	About       string `json:"about"`
}

type ImportRequest struct {
	Provider string          `json:"provider"`
	Leads    []ExtensionLead `json:"leads"`
	PageURL  string          `json:"page_url"`
}

type ImportResult struct {
	Created int `json:"created"`
	Merged  int `json:"merged"`
	Skipped int `json:"skipped"`
}

type TokenRow struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

func main() {
	cfg := loadConfig()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	s := &Server{cfg: cfg, pool: pool}
	if err := s.ensureWorkspace(ctx); err != nil {
		log.Fatalf("workspace: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/extension/session", s.withCORS(s.handleSession))
	mux.HandleFunc("/extension/leads", s.withCORS(s.handleLeads))
	mux.HandleFunc("/extension/tokens", s.withCORS(s.handleTokens))
	mux.HandleFunc("/extension/tokens/", s.withCORS(s.handleTokenByID))
	mux.HandleFunc("/admin/bootstrap-token", s.withCORS(s.handleBootstrapToken))

	log.Printf("dgmos linkedin-import api listening on %s workspace=%s", cfg.HTTPAddr, cfg.WorkspaceName)
	if err := http.ListenAndServe(cfg.HTTPAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *Server) ensureWorkspace(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO workspaces (id, name)
		VALUES ($1::uuid, $2)
		ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
	`, s.cfg.WorkspaceID, s.cfg.WorkspaceName)
	return err
}

func (s *Server) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := s.cfg.CORSOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	workspaceID, _, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var name string
	_ = s.pool.QueryRow(r.Context(), `SELECT name FROM workspaces WHERE id = $1::uuid`, workspaceID).Scan(&name)
	if name == "" {
		name = s.cfg.WorkspaceName
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"organization_id":   workspaceID,
		"organization_name": name,
		"providers":         []string{"linkedin"},
	})
}

func (s *Server) handleLeads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	workspaceID, _, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req ImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "linkedin"
	}
	if provider != "linkedin" {
		writeError(w, http.StatusBadRequest, "unsupported_provider")
		return
	}
	if len(req.Leads) == 0 {
		writeError(w, http.StatusBadRequest, "leads_required")
		return
	}
	if len(req.Leads) > 100 {
		writeError(w, http.StatusBadRequest, "maximum_100_leads")
		return
	}

	result := ImportResult{}
	for _, raw := range req.Leads {
		lead := normalizeLead(raw)
		if lead.ProfileURL == "" || (lead.Name == "" && lead.Company == "") {
			result.Skipped++
			continue
		}
		created, merged, err := s.upsertLead(r.Context(), workspaceID, lead, req.PageURL)
		if err != nil {
			log.Printf("upsert lead failed: %v", err)
			result.Skipped++
			continue
		}
		if created {
			result.Created++
		} else if merged {
			result.Merged++
		} else {
			result.Skipped++
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.adminOK(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		rows, err := s.pool.Query(r.Context(), `
			SELECT id::text, label, created_at, last_used_at
			FROM extension_tokens
			WHERE workspace_id = $1::uuid
			ORDER BY created_at DESC
		`, s.cfg.WorkspaceID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db_error")
			return
		}
		defer rows.Close()
		var out []TokenRow
		for rows.Next() {
			var t TokenRow
			if err := rows.Scan(&t.ID, &t.Label, &t.CreatedAt, &t.LastUsedAt); err != nil {
				writeError(w, http.StatusInternalServerError, "db_error")
				return
			}
			out = append(out, t)
		}
		if out == nil {
			out = []TokenRow{}
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		if !s.adminOK(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var body struct {
			Label string `json:"label"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		label := strings.TrimSpace(body.Label)
		if label == "" {
			label = "Browser extension"
		}
		secret, hash, err := generateToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "token_error")
			return
		}
		var id string
		var createdAt time.Time
		err = s.pool.QueryRow(r.Context(), `
			INSERT INTO extension_tokens (workspace_id, token_hash, label)
			VALUES ($1::uuid, $2, $3)
			RETURNING id::text, created_at
		`, s.cfg.WorkspaceID, hash, label).Scan(&id, &createdAt)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"token": map[string]any{
				"id":         id,
				"label":      label,
				"created_at": createdAt,
			},
			"secret": secret,
		})

	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleTokenByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !s.adminOK(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/extension/tokens/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "token_id_required")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		DELETE FROM extension_tokens WHERE workspace_id = $1::uuid AND id = $2::uuid
	`, s.cfg.WorkspaceID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBootstrapToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !s.adminOK(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	secret, hash, err := generateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error")
		return
	}
	label := "Bootstrap"
	var id string
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO extension_tokens (workspace_id, token_hash, label)
		VALUES ($1::uuid, $2, $3)
		RETURNING id::text
	`, s.cfg.WorkspaceID, hash, label).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"secret": secret,
		"label":  label,
		"hint":   "Paste this secret into the Dgmos Chrome extension once. It will not be shown again.",
	})
}

func (s *Server) adminOK(r *http.Request) bool {
	key := strings.TrimSpace(r.Header.Get("X-Admin-Key"))
	return key != "" && key == s.cfg.AdminKey
}

func (s *Server) authenticate(r *http.Request) (workspaceID, tokenID string, err error) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return "", "", errors.New("missing bearer")
	}
	secret := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	if !strings.HasPrefix(secret, tokenPrefix) {
		return "", "", errors.New("bad prefix")
	}
	hash := hashToken(secret)
	err = s.pool.QueryRow(r.Context(), `
		SELECT workspace_id::text, id::text
		FROM extension_tokens
		WHERE token_hash = $1
	`, hash).Scan(&workspaceID, &tokenID)
	if err != nil {
		return "", "", err
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE extension_tokens SET last_used_at = now() WHERE id = $1::uuid`, tokenID)
	return workspaceID, tokenID, nil
}

func (s *Server) upsertLead(ctx context.Context, workspaceID string, lead ExtensionLead, pageURL string) (created, merged bool, err error) {
	meta, _ := json.Marshal(map[string]any{
		"page_url": pageURL,
		"source":   "linkedin_extension",
	})

	var existingID string
	err = s.pool.QueryRow(ctx, `
		SELECT id::text FROM leads WHERE workspace_id = $1::uuid AND profile_url = $2
	`, workspaceID, lead.ProfileURL).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, false, err
	}

	if existingID == "" {
		_, err = s.pool.Exec(ctx, `
			INSERT INTO leads (
				workspace_id, name, profile_url, linkedin_url, title, company, location,
				email, phone, website, headline, about, metadata
			) VALUES (
				$1::uuid, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''),
				NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13::jsonb
			)
		`, workspaceID, lead.Name, lead.ProfileURL, lead.LinkedInURL, lead.Title, lead.Company, lead.Location,
			lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, string(meta))
		if err != nil {
			return false, false, err
		}
		return true, false, nil
	}

	tag, err := s.pool.Exec(ctx, `
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
		lead.Email, lead.Phone, lead.Website, lead.Headline, lead.About, string(meta))
	if err != nil {
		return false, false, err
	}
	if tag.RowsAffected() > 0 {
		return false, true, nil
	}
	return false, false, nil
}

func normalizeLead(in ExtensionLead) ExtensionLead {
	profile := strings.TrimSpace(in.ProfileURL)
	if profile == "" {
		profile = strings.TrimSpace(in.LinkedInURL)
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = strings.TrimSpace(in.Company)
	}
	return ExtensionLead{
		Name:        name,
		ProfileURL:  strings.TrimRight(profile, "/"),
		LinkedInURL: strings.TrimRight(strings.TrimSpace(in.LinkedInURL), "/"),
		Title:       strings.TrimSpace(in.Title),
		Company:     strings.TrimSpace(in.Company),
		Location:    strings.TrimSpace(in.Location),
		Email:       strings.ToLower(strings.TrimSpace(in.Email)),
		Phone:       strings.TrimSpace(in.Phone),
		Website:     strings.TrimSpace(in.Website),
		Headline:    strings.TrimSpace(in.Headline),
		About:       strings.TrimSpace(in.About),
	}
}

func generateToken() (secret, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	secret = tokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	return secret, hashToken(secret), nil
}

func hashToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
