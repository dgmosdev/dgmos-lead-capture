package config

import "testing"

func TestValidateProductionAdminKey(t *testing.T) {
	cfg := Config{Env: "production", AdminKey: "change-me-admin-key"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected production reject for change-me key")
	}
	cfg.AdminKey = "strong-secret-value"
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg.Env = "development"
	cfg.AdminKey = "change-me-admin-key"
	if err := cfg.Validate(); err != nil {
		t.Fatal("development should allow default key")
	}
}
