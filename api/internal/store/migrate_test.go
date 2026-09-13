package store

import (
	"strings"
	"testing"

	"github.com/dgmos/linkedin-import/internal/mapping"
)

func TestCreateTableSQLMySQL(t *testing.T) {
	s := &Store{d: DialectMySQL, m: mapping.Default()}
	stmts, err := s.createTableSQL()
	if err != nil {
		t.Fatal(err)
	}
	if len(stmts) != 2 {
		t.Fatalf("got %d stmts", len(stmts))
	}
	if !strings.Contains(stmts[0], "CREATE TABLE IF NOT EXISTS") || !strings.Contains(stmts[0], "`leads`") {
		t.Fatalf("leads sql: %s", stmts[0])
	}
	if !strings.Contains(stmts[1], "`extension_tokens`") {
		t.Fatalf("tokens sql: %s", stmts[1])
	}
}
