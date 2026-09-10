package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

func HashToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func GenerateToken(prefix string) (secret, hash string, err error) {
	if prefix == "" {
		prefix = "dgext_"
	}
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	secret = prefix + base64.RawURLEncoding.EncodeToString(buf)
	return secret, HashToken(secret), nil
}

func HasValidPrefix(secret, prefix string) bool {
	if prefix == "" {
		prefix = "dgext_"
	}
	return strings.HasPrefix(secret, prefix)
}
