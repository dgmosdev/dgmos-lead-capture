package store

import (
	"testing"
	"time"

	"github.com/dgmos/linkedin-import/internal/mapping"
)

func TestParseDBTimeUnixAndSQL(t *testing.T) {
	got, err := parseDBTime(int64(1710000000))
	if err != nil || got.Unix() != 1710000000 {
		t.Fatalf("unix seconds: %v %v", got, err)
	}
	got, err = parseDBTime(int64(1710000000123))
	if err != nil || got.UnixMilli() != 1710000000123 {
		t.Fatalf("unix millis: %v %v", got, err)
	}
	got, err = parseDBTime("2026-09-12 11:00:00")
	if err != nil || got.Year() != 2026 {
		t.Fatalf("sql datetime: %v %v", got, err)
	}
}

func TestStringifyDBInt(t *testing.T) {
	got, err := stringifyDB(int64(42))
	if err != nil || got != "42" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestNowExprAndSoftDelete(t *testing.T) {
	s := &Store{d: DialectMySQL, m: mapping.Default()}
	if s.nowExpr() != "UNIX_TIMESTAMP()" {
		t.Fatalf("now: %s", s.nowExpr())
	}
	if s.leadDeletedClause() != "`deleted_at` IS NULL" {
		t.Fatalf("deleted: %s", s.leadDeletedClause())
	}
	set, pred := s.leadUndeleteSQL()
	if set != "`deleted_at` = NULL," || pred != "`deleted_at` IS NOT NULL" {
		t.Fatalf("undelete: %q %q", set, pred)
	}
	n, ok := s.timeArg(time.Unix(1710000000, 0).UTC()).(int64)
	if !ok || n != 1710000000 {
		t.Fatalf("timeArg unix: %v", n)
	}
}
