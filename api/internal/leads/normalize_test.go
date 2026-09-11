package leads

import "testing"

func TestNormalizeUsesLinkedInURL(t *testing.T) {
	out := Normalize(Lead{
		Name:        " Ada ",
		LinkedInURL: "https://www.linkedin.com/in/ada/",
		Email:       "Ada@Example.COM",
	})
	if out.ProfileURL != "https://www.linkedin.com/in/ada" {
		t.Fatalf("profile: %q", out.ProfileURL)
	}
	if out.Name != "Ada" {
		t.Fatalf("name: %q", out.Name)
	}
	if out.Email != "ada@example.com" {
		t.Fatalf("email: %q", out.Email)
	}
}

func TestValidRequiresURLAndIdentity(t *testing.T) {
	if Valid(Normalize(Lead{Name: "A"})) {
		t.Fatal("missing url should fail")
	}
	if Valid(Normalize(Lead{ProfileURL: "https://x"})) {
		t.Fatal("missing name/company should fail")
	}
	if !Valid(Normalize(Lead{ProfileURL: "https://x", Company: "Acme"})) {
		t.Fatal("company-only should pass")
	}
	if !Valid(Normalize(Lead{LinkedInURL: "https://x/", Name: "A"})) {
		t.Fatal("name+linkedin should pass")
	}
}

func TestDeriveEnrichStatus(t *testing.T) {
	listed := DeriveEnrichStatus(Lead{ProfileURL: "https://www.linkedin.com/in/a", Name: "A", Title: "Eng"})
	if listed != EnrichListed {
		t.Fatalf("expected listed, got %q", listed)
	}
	enriched := DeriveEnrichStatus(Lead{ProfileURL: "https://www.linkedin.com/in/a", Name: "A", Email: "a@x.com"})
	if enriched != EnrichEnriched {
		t.Fatalf("expected enriched, got %q", enriched)
	}
	company := DeriveEnrichStatus(Lead{ProfileURL: "https://www.linkedin.com/company/acme", Name: "Acme", Website: "https://acme.test"})
	if company != EnrichEnriched {
		t.Fatalf("company+website should enrich, got %q", company)
	}
}
