package config

import "testing"

func TestFeaturesAIProviderGate(t *testing.T) {
	cfg := Config{AIProvider: "", EnrichEnabled: "auto"}
	f := cfg.Features()
	if f["ai"] != false {
		t.Fatalf("expected ai false, got %#v", f["ai"])
	}
	if _, ok := f["enrich"]; ok {
		t.Fatalf("auto enrich should omit enrich key, got %#v", f["enrich"])
	}

	cfg.AIProvider = "host"
	f = cfg.Features()
	if f["ai"] != true || f["ai_provider"] != "host" {
		t.Fatalf("expected ai host, got %#v", f)
	}

	cfg.AIProvider = ""
	cfg.EnrichEnabled = "true"
	f = cfg.Features()
	if f["enrich"] != true {
		t.Fatalf("expected enrich true override, got %#v", f["enrich"])
	}
}
