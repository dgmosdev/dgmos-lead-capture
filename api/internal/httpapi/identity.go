package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/dgmos/linkedin-import/internal/auth"
	"github.com/dgmos/linkedin-import/internal/store"
)

func (s *Server) authenticate(r *http.Request) (store.Principal, error) {
	switch s.cfg.Mapping.AuthMode() {
	case "header":
		return s.principalFromHeaders(r)
	case "jwt":
		return s.principalFromJWT(r)
	default:
		return s.principalFromTokenTable(r)
	}
}

func (s *Server) principalFromHeaders(r *http.Request) (store.Principal, error) {
	h := s.cfg.Mapping.Auth.Header
	user := strings.TrimSpace(r.Header.Get(h.UserID))
	customer := strings.TrimSpace(r.Header.Get(h.CustomerID))
	if user == "" || customer == "" {
		return store.Principal{}, errMissingBearer
	}
	return store.Principal{UserID: user, CustomerID: customer}, nil
}

func (s *Server) principalFromTokenTable(r *http.Request) (store.Principal, error) {
	secret, err := bearerSecret(r)
	if err != nil {
		return store.Principal{}, err
	}
	if !auth.HasValidPrefix(secret, s.cfg.TokenPrefix) {
		return store.Principal{}, errBadPrefix
	}
	p, err := s.store.LookupToken(r.Context(), auth.HashToken(secret))
	if err != nil {
		return store.Principal{}, err
	}
	s.store.TouchToken(r.Context(), p.TokenID)
	if p.UserID == "" || p.CustomerID == "" {
		return store.Principal{}, errBadPrefix
	}
	return p, nil
}

func (s *Server) principalFromJWT(r *http.Request) (store.Principal, error) {
	raw, err := bearerSecret(r)
	if err != nil {
		return store.Principal{}, err
	}
	secret := strings.TrimSpace(os.Getenv(s.cfg.Mapping.Auth.JWT.SecretEnv))
	if secret == "" {
		return store.Principal{}, errors.New("jwt secret missing")
	}
	claims, err := parseHS256(raw, secret)
	if err != nil {
		return store.Principal{}, err
	}
	j := s.cfg.Mapping.Auth.JWT
	user := claimString(claims, j.UserClaim)
	customer := claimString(claims, j.CustomerClaim)
	if user == "" || customer == "" {
		return store.Principal{}, errBadPrefix
	}
	return store.Principal{UserID: user, CustomerID: customer}, nil
}

func bearerSecret(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", errMissingBearer
	}
	secret := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if secret == "" {
		return "", errMissingBearer
	}
	return secret, nil
}

func claimString(claims map[string]any, key string) string {
	if key == "" {
		return ""
	}
	v, ok := claims[key]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func parseHS256(token, secret string) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid jwt")
	}
	signing := parts[0] + "." + parts[1]
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signing))
	if !hmac.Equal(mac.Sum(nil), sig) {
		return nil, errors.New("invalid jwt signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func firstHostID(raws ...json.RawMessage) (string, bool) {
	for _, raw := range raws {
		if id, ok := parseHostID(raw); ok {
			return id, true
		}
	}
	return "", false
}

func parseHostID(raw json.RawMessage) (string, bool) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return "", false
	}
	s = strings.Trim(s, `"`)
	if s == "" || s == "0" {
		return "", false
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || n == 0 {
		return "", false
	}
	return strconv.FormatUint(n, 10), true
}
