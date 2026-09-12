package mapping

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultValid(t *testing.T) {
	m := Default()
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	if m.AuthMode() != "token_table" {
		t.Fatalf("mode: %s", m.AuthMode())
	}
}

func TestLoadFileMergesAndOmits(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "map.yaml")
	src := []byte(`
schema: crm
auth:
  mode: header
  header:
    user_id: X-Uid
leads:
  table: contacts
  columns:
    name: full_name
    phone: ""
`)
	if err := os.WriteFile(path, src, 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Schema != "crm" || m.Leads.Table != "contacts" {
		t.Fatalf("merge table: %#v", m.Leads)
	}
	if m.Leads.Col("name") != "full_name" {
		t.Fatalf("name col: %q", m.Leads.Col("name"))
	}
	if m.Leads.Has("phone") {
		t.Fatal("empty phone should omit column")
	}
	if m.Auth.Header.UserID != "X-Uid" {
		t.Fatalf("header: %#v", m.Auth.Header)
	}
}

func TestRejectsBadIdent(t *testing.T) {
	m := Default()
	m.Leads.Table = "leads;drop"
	if err := m.Validate(); err == nil {
		t.Fatal("expected ident error")
	}
}

func TestTokenTableRequiresTokens(t *testing.T) {
	m := Default()
	m.Tokens.Table = ""
	if err := m.Validate(); err == nil {
		t.Fatal("expected tokens.table required")
	}
}
