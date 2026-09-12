package httpapi

import (
	"encoding/json"
	"testing"
)

func TestParseHostID(t *testing.T) {
	cases := []struct {
		raw  string
		want string
		ok   bool
	}{
		{`123`, "123", true},
		{`"456"`, "456", true},
		{`null`, "", false},
		{``, "", false},
		{`"0"`, "", false},
		{`0`, "", false},
		{`"abc"`, "", false},
		{`"11111111-1111-1111-1111-111111111111"`, "", false},
	}
	for _, tc := range cases {
		got, ok := parseHostID(json.RawMessage(tc.raw))
		if ok != tc.ok || got != tc.want {
			t.Fatalf("parseHostID(%s)=%q %v, want %q %v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}

func TestFirstHostIDAlias(t *testing.T) {
	id, ok := firstHostID(json.RawMessage("null"), json.RawMessage("99"))
	if !ok || id != "99" {
		t.Fatalf("alias: %q %v", id, ok)
	}
}
