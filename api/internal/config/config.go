package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL   string
	HTTPAddr      string
	AdminKey      string
	WorkspaceID   string
	WorkspaceName string
	CORSOrigin    string
	TokenPrefix   string
	Env           string
	AIProvider    string
	EnrichEnabled string // auto | true | false
}

func Load() Config {
	return Config{
		DatabaseURL:   env("DATABASE_URL", "postgres://dgmos:dgmos@localhost:5433/dgmos_leads?sslmode=disable"),
		HTTPAddr:      env("HTTP_ADDR", ":8088"),
		AdminKey:      env("ADMIN_KEY", "change-me-admin-key"),
		WorkspaceID:   env("WORKSPACE_ID", "11111111-1111-1111-1111-111111111111"),
		WorkspaceName: env("WORKSPACE_NAME", "Dgmos"),
		CORSOrigin:    env("CORS_ORIGIN", "*"),
		TokenPrefix:   env("TOKEN_PREFIX", "dgext_"),
		Env:           strings.ToLower(env("ENV", env("APP_ENV", "development"))),
		AIProvider:    strings.TrimSpace(env("AI_PROVIDER", "")),
		EnrichEnabled: strings.ToLower(strings.TrimSpace(env("ENRICH_ENABLED", "auto"))),
	}
}

func (c Config) IsProduction() bool {
	return c.Env == "production" || c.Env == "prod"
}

func (c Config) Features() map[string]any {
	provider := strings.ToLower(strings.TrimSpace(c.AIProvider))
	if provider == "none" || provider == "off" || provider == "false" || provider == "0" {
		provider = ""
	}
	ai := provider != ""
	out := map[string]any{
		"ai":          ai,
		"ai_provider": nil,
	}
	if ai {
		out["ai_provider"] = provider
	}
	// Only pin enrich when host explicitly configures ENRICH_ENABLED; "auto" defers to the extension.
	switch c.EnrichEnabled {
	case "true", "1", "yes", "on":
		out["enrich"] = true
	case "false", "0", "no", "off":
		out["enrich"] = false
	}
	return out
}

func (c Config) Validate() error {
	if c.IsProduction() {
		key := strings.TrimSpace(c.AdminKey)
		if key == "" || strings.HasPrefix(strings.ToLower(key), "change-me") {
			return fmt.Errorf("ADMIN_KEY must be set to a strong value in production")
		}
	}
	return nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
