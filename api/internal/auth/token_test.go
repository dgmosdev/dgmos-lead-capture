package auth

import "testing"

func TestHashTokenDeterministic(t *testing.T) {
	a := HashToken("dgext_abc")
	b := HashToken("dgext_abc")
	c := HashToken("dgext_xyz")
	if a != b {
		t.Fatalf("expected equal hashes")
	}
	if a == c {
		t.Fatalf("expected different hashes")
	}
	if len(a) != 64 {
		t.Fatalf("expected sha256 hex length 64, got %d", len(a))
	}
}

func TestGenerateTokenPrefix(t *testing.T) {
	secret, hash, err := GenerateToken("dgext_")
	if err != nil {
		t.Fatal(err)
	}
	if !HasValidPrefix(secret, "dgext_") {
		t.Fatalf("missing prefix: %s", secret)
	}
	if HashToken(secret) != hash {
		t.Fatalf("hash mismatch")
	}
}

func TestHasValidPrefix(t *testing.T) {
	if !HasValidPrefix("dgext_x", "dgext_") {
		t.Fatal("expected true")
	}
	if HasValidPrefix("other_x", "dgext_") {
		t.Fatal("expected false")
	}
}
