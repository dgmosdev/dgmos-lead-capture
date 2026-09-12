package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/dgmos/linkedin-import/internal/mapping"
)

type Config struct {
	DatabaseURL   string
	HTTPAddr      string
	AdminKey      string
	DisplayName   string
	CORSOrigin    string
	TokenPrefix   string
	Env           string
	AIProvider    string
	EnrichEnabled string // auto | true | false
	MappingFile   string
	SchemaCheck   bool
	Mapping       mapping.Mapping
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:   env("DATABASE_URL", ""),
		HTTPAddr:      env("HTTP_ADDR", ":8088"),
		AdminKey:      env("ADMIN_KEY", "change-me-admin-key"),
		DisplayName:   firstEnv("DISPLAY_NAME", "WORKSPACE_NAME", "Dgmos"),
		CORSOrigin:    env("CORS_ORIGIN", "*"),
		TokenPrefix:   env("TOKEN_PREFIX", "dgext_"),
		Env:           strings.ToLower(env("ENV", env("APP_ENV", "development"))),
		AIProvider:    strings.TrimSpace(env("AI_PROVIDER", "")),
		EnrichEnabled: strings.ToLower(strings.TrimSpace(env("ENRICH_ENABLED", "auto"))),
		MappingFile:   env("MAPPING_FILE", ""),
		SchemaCheck:   envBool("SCHEMA_CHECK", true),
	}
	m, err := mapping.LoadFile(c.MappingFile)
	if err != nil {
		return Config{}, err
	}
	c.Mapping = m
	return c, nil
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
	switch c.EnrichEnabled {
	case "true", "1", "yes", "on":
		out["enrich"] = true
	case "false", "0", "no", "off":
		out["enrich"] = false
	}
	return out
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	if c.IsProduction() {
		key := strings.TrimSpace(c.AdminKey)
		if key == "" || strings.HasPrefix(strings.ToLower(key), "change-me") {
			return fmt.Errorf("ADMIN_KEY must be set to a strong value in production")
		}
	}
	return c.Mapping.Validate()
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func firstEnv(keys ...string) string {
	fallback := ""
	if len(keys) > 0 {
		fallback = keys[len(keys)-1]
		keys = keys[:len(keys)-1]
	}
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}
