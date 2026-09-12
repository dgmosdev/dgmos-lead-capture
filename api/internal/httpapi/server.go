package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dgmos/linkedin-import/internal/auth"
	"github.com/dgmos/linkedin-import/internal/config"
	"github.com/dgmos/linkedin-import/internal/leads"
	"github.com/dgmos/linkedin-import/internal/store"
)

type Server struct {
	cfg   config.Config
	store *store.Store
	log   *slog.Logger
	limit *rateLimiter
}

type ImportRequest struct {
	Provider string       `json:"provider"`
	Leads    []leads.Lead `json:"leads"`
	PageURL  string       `json:"page_url"`
}

type ImportResult struct {
	Created int `json:"created"`
	Merged  int `json:"merged"`
	Skipped int `json:"skipped"`
}

func New(cfg config.Config, st *store.Store, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg:   cfg,
		store: st,
		log:   log,
		limit: newRateLimiter(60, time.Minute),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/v1/health", s.withCORS(s.handleHealth))
	mux.HandleFunc("/healthz", s.withCORS(s.handleHealth))

	mux.HandleFunc("/v1/session", s.withCORS(s.handleSession))
	mux.HandleFunc("/v1/leads", s.withCORS(s.handleLeads))
	mux.HandleFunc("/v1/leads/", s.withCORS(s.handleLeadByID))
	mux.HandleFunc("/v1/tokens", s.withCORS(s.handleTokens))
	mux.HandleFunc("/v1/tokens/", s.withCORS(s.handleTokenByID))

	return s.withRequestID(mux)
}

func (s *Server) withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			buf := make([]byte, 8)
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), ctxKeyRequestID{}, id)
		start := time.Now()
		next.ServeHTTP(w, r.WithContext(ctx))
		s.log.Info("request",
			"request_id", id,
			"method", r.Method,
			"path", r.URL.Path,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

type ctxKeyRequestID struct{}

func (s *Server) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := s.cfg.CORSOrigin
		if origin == "" {
			origin = "*"
		}
		if origin == "*" && s.cfg.IsProduction() {
			s.log.Warn("CORS_ORIGIN is wildcard in production; prefer a specific origin")
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Key, X-Request-Id")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "db_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	principal, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"create_user_id":     principal.UserID,
		"create_customer_id": principal.CustomerID,
		"name":               s.cfg.DisplayName,
		"providers":          []string{"linkedin"},
		"features":           s.cfg.Features(),
	})
}

func (s *Server) handleLeads(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleListLeads(w, r)
	case http.MethodPost:
		s.handleImportLeads(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleListLeads(w http.ResponseWriter, r *http.Request) {
	principal, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.limit.allow(rateKey(principal)) {
		writeError(w, http.StatusTooManyRequests, "rate_limited")
		return
	}

	q := r.URL.Query()
	limit := 30
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	result, err := s.store.ListLeads(r.Context(), principal.CustomerID, store.ListLeadsOpts{
		Limit:        limit,
		Cursor:       strings.TrimSpace(q.Get("cursor")),
		EnrichStatus: strings.TrimSpace(q.Get("enrich_status")),
		AIStatus:     strings.TrimSpace(q.Get("ai_status")),
		Query:        strings.TrimSpace(q.Get("q")),
		Sort:         strings.TrimSpace(q.Get("sort")),
	})
	if err != nil {
		if strings.Contains(err.Error(), "invalid_cursor") {
			writeError(w, http.StatusBadRequest, "invalid_cursor")
			return
		}
		s.log.Error("list leads failed", "error", err)
		writeError(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleImportLeads(w http.ResponseWriter, r *http.Request) {
	principal, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.limit.allow(rateKey(principal)) {
		writeError(w, http.StatusTooManyRequests, "rate_limited")
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
	if len(req.Leads) > leads.MaxBatch {
		writeError(w, http.StatusBadRequest, "maximum_100_leads")
		return
	}

	result := ImportResult{}
	for _, raw := range req.Leads {
		lead := leads.Normalize(raw)
		if !leads.Valid(lead) {
			result.Skipped++
			continue
		}
		created, merged, err := s.store.UpsertLead(r.Context(), principal.UserID, principal.CustomerID, lead, req.PageURL)
		if err != nil {
			s.log.Error("upsert lead failed", "error", err)
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

func (s *Server) handleLeadByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	principal, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.limit.allow(rateKey(principal)) {
		writeError(w, http.StatusTooManyRequests, "rate_limited")
		return
	}

	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/leads/"), "/")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusBadRequest, "lead_id_required")
		return
	}

	var body struct {
		AIStatus     string `json:"ai_status"`
		EnrichStatus string `json:"enrich_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	ai := strings.ToLower(strings.TrimSpace(body.AIStatus))
	enrich := strings.ToLower(strings.TrimSpace(body.EnrichStatus))
	if ai == "" && enrich == "" {
		writeError(w, http.StatusBadRequest, "status_required")
		return
	}
	ok, err := s.store.UpdateLeadStatus(r.Context(), principal.CustomerID, id, enrich, ai)
	if err != nil {
		if strings.Contains(err.Error(), "invalid_status") {
			writeError(w, http.StatusBadRequest, "invalid_status")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (s *Server) handleTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.adminOK(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		out, err := s.store.ListTokens(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		if !s.adminOK(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var body struct {
			Label       string          `json:"label"`
			UserID      json.RawMessage `json:"create_user_id"`
			UserAlias   json.RawMessage `json:"user_id"`
			CustomerID  json.RawMessage `json:"create_customer_id"`
			WorkspaceID json.RawMessage `json:"workspace_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		userID, _ := firstHostID(body.UserID, body.UserAlias)
		customerID, customerOK := firstHostID(body.CustomerID, body.WorkspaceID)
		if !customerOK {
			writeError(w, http.StatusBadRequest, "create_ids_required")
			return
		}
		if userID == "" {
			userID = customerID
		}
		label := strings.TrimSpace(body.Label)
		if label == "" {
			label = "Browser extension"
		}
		secret, hash, err := auth.GenerateToken(s.cfg.TokenPrefix)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "token_error")
			return
		}
		id, createdAt, err := s.store.InsertToken(r.Context(), store.TokenInsert{
			UserID:     userID,
			CustomerID: customerID,
			Hash:       hash,
			Label:      label,
		})
		if err != nil {
			s.log.Error("insert token", "error", err)
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
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/tokens/"), "/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "token_id_required")
		return
	}
	ok, err := s.store.DeleteToken(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminOK(r *http.Request) bool {
	key := strings.TrimSpace(r.Header.Get("X-Admin-Key"))
	return key != "" && key == s.cfg.AdminKey
}

func rateKey(p store.Principal) string {
	if p.TokenID != "" {
		return p.TokenID
	}
	return p.CustomerID + ":" + p.UserID
}

var (
	errMissingBearer = &authError{"missing bearer"}
	errBadPrefix     = &authError{"bad prefix"}
)

type authError struct{ msg string }

func (e *authError) Error() string { return e.msg }

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

type rateLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	requests map[string][]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:    limit,
		window:   window,
		requests: make(map[string][]time.Time),
	}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	arr := rl.requests[key]
	kept := arr[:0]
	for _, t := range arr {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.limit {
		rl.requests[key] = kept
		return false
	}
	rl.requests[key] = append(kept, now)
	return true
}
