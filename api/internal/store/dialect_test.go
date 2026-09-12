package store

import "testing"

func TestRebindPostgres(t *testing.T) {
	got := DialectPostgres.Rebind("SELECT * FROM leads WHERE id = ? AND create_customer_id = ?")
	want := "SELECT * FROM leads WHERE id = $1 AND create_customer_id = $2"
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestRebindMySQLLeavesQuestionMarks(t *testing.T) {
	q := "SELECT * FROM leads WHERE id = ?"
	if got := DialectMySQL.Rebind(q); got != q {
		t.Fatalf("got %q", got)
	}
}

func TestParseDatabaseURL(t *testing.T) {
	pg, err := parseDatabaseURL("postgres://dgmos:dgmos@localhost:5433/dgmos_leads?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if pg.Dialect != DialectPostgres || pg.Driver != "pgx" {
		t.Fatalf("postgres parse: %#v", pg)
	}

	my, err := parseDatabaseURL("mysql://dgmos:secret@127.0.0.1:3307/dgmos_leads")
	if err != nil {
		t.Fatal(err)
	}
	if my.Dialect != DialectMySQL || my.Driver != "mysql" {
		t.Fatalf("mysql parse: %#v", my)
	}
	if !containsAll(my.DSN, "dgmos:secret@tcp(127.0.0.1:3307)/dgmos_leads", "parseTime=true", "charset=utf8mb4") {
		t.Fatalf("mysql dsn: %q", my.DSN)
	}

	if _, err := parseDatabaseURL("sqlite://x"); err == nil {
		t.Fatal("expected unsupported scheme")
	}
}

func TestContainsOp(t *testing.T) {
	if DialectPostgres.Contains("name") != "name ILIKE ?" {
		t.Fatal(DialectPostgres.Contains("name"))
	}
	if DialectMySQL.Contains("name") != "name LIKE ?" {
		t.Fatal(DialectMySQL.Contains("name"))
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !contains(s, p) {
			return false
		}
	}
	return true
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
