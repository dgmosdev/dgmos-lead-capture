package mapping

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Mapping binds this process to a host project's existing tables.
// This kit never owns schema; it only reads/writes what you map.
type Mapping struct {
	// Schema is an optional default qualifier (Postgres schema or MySQL database).
	Schema string `yaml:"schema"`
	Auth   Auth   `yaml:"auth"`
	Leads  Table  `yaml:"leads"`
	Tokens Table  `yaml:"tokens"`
}

type Auth struct {
	// Mode: token_table | header | jwt
	Mode   string     `yaml:"mode"`
	Header HeaderAuth `yaml:"header"`
	JWT    JWTAuth    `yaml:"jwt"`
}

type HeaderAuth struct {
	UserID     string `yaml:"user_id"`
	CustomerID string `yaml:"customer_id"`
}

type JWTAuth struct {
	SecretEnv     string `yaml:"secret_env"`
	UserClaim     string `yaml:"user_claim"`
	CustomerClaim string `yaml:"customer_claim"`
}

type Table struct {
	Schema  string            `yaml:"schema"`
	Table   string            `yaml:"table"`
	Columns map[string]string `yaml:"columns"`
}

var identRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func Default() Mapping {
	return Mapping{
		Auth: Auth{
			Mode: "token_table",
			Header: HeaderAuth{
				UserID:     "X-User-Id",
				CustomerID: "X-Customer-Id",
			},
			JWT: JWTAuth{
				SecretEnv:     "JWT_SECRET",
				UserClaim:     "user_id",
				CustomerClaim: "customer_id",
			},
		},
		Leads: Table{
			Table: "leads",
			Columns: map[string]string{
				"id":                 "id",
				"create_user_id":     "create_user_id",
				"create_customer_id": "create_customer_id",
				"name":               "name",
				"profile_url":        "profile_url",
				"linkedin_url":       "linkedin_url",
				"title":              "title",
				"company":            "company",
				"location":           "location",
				"email":              "email",
				"phone":              "phone",
				"website":            "website",
				"headline":           "headline",
				"about":              "about",
				"enrich_status":      "enrich_status",
				"ai_status":          "ai_status",
				"metadata":           "metadata",
				"created_at":         "created_at",
				"updated_at":         "updated_at",
				"deleted_at":         "deleted_at",
			},
		},
		Tokens: Table{
			Table: "extension_tokens",
			Columns: map[string]string{
				"id":                 "id",
				"token_hash":         "token_hash",
				"label":              "label",
				"created_at":         "created_at",
				"create_user_id":     "create_user_id",
				"create_customer_id": "create_customer_id",
				"last_used_at":       "last_used_at",
			},
		},
	}
}

func LoadFile(path string) (Mapping, error) {
	m := Default()
	if strings.TrimSpace(path) == "" {
		return m, m.Validate()
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Mapping{}, fmt.Errorf("mapping file: %w", err)
	}
	var over Mapping
	if err := yaml.Unmarshal(raw, &over); err != nil {
		return Mapping{}, fmt.Errorf("mapping yaml: %w", err)
	}
	m.merge(over)
	return m, m.Validate()
}

func (m *Mapping) merge(o Mapping) {
	if s := strings.TrimSpace(o.Schema); s != "" {
		m.Schema = s
	}
	if mode := strings.TrimSpace(o.Auth.Mode); mode != "" {
		m.Auth.Mode = mode
	}
	mergeHeader(&m.Auth.Header, o.Auth.Header)
	mergeJWT(&m.Auth.JWT, o.Auth.JWT)
	mergeTable(&m.Leads, o.Leads)
	mergeTable(&m.Tokens, o.Tokens)
}

func mergeHeader(dst *HeaderAuth, src HeaderAuth) {
	if src.UserID != "" {
		dst.UserID = src.UserID
	}
	if src.CustomerID != "" {
		dst.CustomerID = src.CustomerID
	}
}

func mergeJWT(dst *JWTAuth, src JWTAuth) {
	if src.SecretEnv != "" {
		dst.SecretEnv = src.SecretEnv
	}
	if src.UserClaim != "" {
		dst.UserClaim = src.UserClaim
	}
	if src.CustomerClaim != "" {
		dst.CustomerClaim = src.CustomerClaim
	}
}

func mergeTable(dst *Table, src Table) {
	if src.Schema != "" {
		dst.Schema = src.Schema
	}
	if src.Table == "-" || strings.EqualFold(src.Table, "none") {
		dst.Table = ""
	} else if src.Table != "" {
		dst.Table = src.Table
	}
	if dst.Columns == nil {
		dst.Columns = map[string]string{}
	}
	for k, v := range src.Columns {
		if strings.TrimSpace(v) == "" {
			delete(dst.Columns, k)
			continue
		}
		dst.Columns[k] = v
	}
}

func (m Mapping) AuthMode() string {
	mode := strings.ToLower(strings.TrimSpace(m.Auth.Mode))
	if mode == "" {
		return "token_table"
	}
	return mode
}

func (t Table) Enabled() bool {
	return strings.TrimSpace(t.Table) != ""
}

func (t Table) Col(logical string) string {
	if t.Columns == nil {
		return ""
	}
	return strings.TrimSpace(t.Columns[logical])
}

func (t Table) Has(logical string) bool {
	return t.Col(logical) != ""
}

func (t Table) SchemaOr(fallback string) string {
	if s := strings.TrimSpace(t.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(fallback)
}

func (m Mapping) Validate() error {
	switch m.AuthMode() {
	case "token_table", "header", "jwt":
	default:
		return fmt.Errorf("auth.mode must be token_table, header, or jwt")
	}
	if err := validIdent("schema", m.Schema); err != nil {
		return err
	}
	if !m.Leads.Enabled() {
		return fmt.Errorf("leads.table is required")
	}
	for _, key := range []string{"id", "create_customer_id", "name", "profile_url", "created_at", "updated_at", "deleted_at"} {
		if !m.Leads.Has(key) {
			return fmt.Errorf("leads.columns.%s is required", key)
		}
	}
	if err := uniquePhysicals("leads", m.Leads); err != nil {
		return err
	}
	if err := validateTable("leads", m.Leads); err != nil {
		return err
	}
	if m.AuthMode() == "token_table" {
		if !m.Tokens.Enabled() {
			return fmt.Errorf("tokens.table is required when auth.mode=token_table")
		}
		for _, key := range []string{"id", "token_hash", "create_customer_id"} {
			if !m.Tokens.Has(key) {
				return fmt.Errorf("tokens.columns.%s is required", key)
			}
		}
		if err := uniquePhysicals("tokens", m.Tokens); err != nil {
			return err
		}
		if err := validateTable("tokens", m.Tokens); err != nil {
			return err
		}
	}
	return nil
}

func validateTable(label string, t Table) error {
	if err := validIdent(label+".schema", t.Schema); err != nil {
		return err
	}
	if err := validIdent(label+".table", t.Table); err != nil {
		return err
	}
	for logical, physical := range t.Columns {
		if err := validIdent(label+".columns."+logical, physical); err != nil {
			return err
		}
	}
	return nil
}

func uniquePhysicals(label string, t Table) error {
	seen := map[string]string{}
	for logical, physical := range t.Columns {
		p := strings.ToLower(strings.TrimSpace(physical))
		if p == "" {
			continue
		}
		if other, ok := seen[p]; ok {
			return fmt.Errorf("%s.columns.%s and %s both map to %s", label, other, logical, physical)
		}
		seen[p] = logical
	}
	return nil
}

func validIdent(field, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if !identRE.MatchString(value) {
		return fmt.Errorf("%s is not a safe SQL identifier: %q", field, value)
	}
	return nil
}
