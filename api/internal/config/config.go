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
	}
}

func (c Config) IsProduction() bool {
	return c.Env == "production" || c.Env == "prod"
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
