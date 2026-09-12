package store

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type Dialect int

const (
	DialectPostgres Dialect = iota
	DialectMySQL
)

func (d Dialect) String() string {
	if d == DialectMySQL {
		return "mysql"
	}
	return "postgres"
}

func (d Dialect) Rebind(query string) string {
	if d != DialectPostgres {
		return query
	}
	n := 0
	var b strings.Builder
	b.Grow(len(query) + 8)
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			continue
		}
		b.WriteByte(query[i])
	}
	return b.String()
}

func (d Dialect) Contains(column string) string {
	if d == DialectPostgres {
		return column + " ILIKE ?"
	}
	return column + " LIKE ?"
}

func (d Dialect) Quote(ident string) string {
	ident = strings.TrimSpace(ident)
	if ident == "" {
		return ""
	}
	if d == DialectMySQL {
		return "`" + strings.ReplaceAll(ident, "`", "") + "`"
	}
	return `"` + strings.ReplaceAll(ident, `"`, "") + `"`
}

func (d Dialect) Qualify(schema, table string) string {
	t := d.Quote(table)
	if strings.TrimSpace(schema) == "" {
		return t
	}
	return d.Quote(schema) + "." + t
}

func (d Dialect) MergeJSON(column string) string {
	if d == DialectPostgres {
		return fmt.Sprintf("%s = COALESCE(%s, '{}'::jsonb) || ?::jsonb", column, column)
	}
	return fmt.Sprintf("%s = JSON_MERGE_PATCH(IFNULL(%s, JSON_OBJECT()), CAST(? AS JSON))", column, column)
}

type dsnInfo struct {
	Dialect Dialect
	Driver  string
	DSN     string
}

func parseDatabaseURL(raw string) (dsnInfo, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return dsnInfo{}, fmt.Errorf("DATABASE_URL is empty")
	}

	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "postgres://"), strings.HasPrefix(lower, "postgresql://"):
		return dsnInfo{Dialect: DialectPostgres, Driver: "pgx", DSN: raw}, nil
	case strings.HasPrefix(lower, "mysql://"):
		dsn, err := mysqlDSNFromURL(raw)
		if err != nil {
			return dsnInfo{}, err
		}
		return dsnInfo{Dialect: DialectMySQL, Driver: "mysql", DSN: dsn}, nil
	default:
		return dsnInfo{}, fmt.Errorf("unsupported DATABASE_URL scheme (use postgres:// or mysql://)")
	}
}

func mysqlDSNFromURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("mysql dsn: %w", err)
	}
	user := ""
	if u.User != nil {
		name := u.User.Username()
		if pass, ok := u.User.Password(); ok {
			user = name + ":" + pass
		} else {
			user = name
		}
	}
	host := u.Host
	if host == "" {
		host = "127.0.0.1:3306"
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if dbName == "" {
		return "", fmt.Errorf("mysql dsn: database name required")
	}
	q := u.Query()
	if q.Get("parseTime") == "" {
		q.Set("parseTime", "true")
	}
	if q.Get("loc") == "" {
		q.Set("loc", "UTC")
	}
	if q.Get("multiStatements") == "" {
		q.Set("multiStatements", "true")
	}
	return fmt.Sprintf("%s@tcp(%s)/%s?%s", user, host, dbName, q.Encode()), nil
}
