package store

import (
	"fmt"
	"strconv"
	"time"
)

type flexID string

func (id *flexID) Scan(src any) error {
	s, err := stringifyDB(src)
	if err != nil {
		return err
	}
	*id = flexID(s)
	return nil
}

type flexTime struct{ t time.Time }

func (ft *flexTime) Scan(src any) error {
	t, err := parseDBTime(src)
	if err != nil {
		return err
	}
	ft.t = t
	return nil
}

func stringifyDB(src any) (string, error) {
	if src == nil {
		return "", nil
	}
	switch v := src.(type) {
	case string:
		return v, nil
	case []byte:
		return string(v), nil
	case int64:
		return strconv.FormatInt(v, 10), nil
	case int32:
		return strconv.FormatInt(int64(v), 10), nil
	case int:
		return strconv.Itoa(v), nil
	case uint64:
		return strconv.FormatUint(v, 10), nil
	case uint32:
		return strconv.FormatUint(uint64(v), 10), nil
	case float64:
		return strconv.FormatInt(int64(v), 10), nil
	default:
		return fmt.Sprint(v), nil
	}
}

func parseDBTime(src any) (time.Time, error) {
	if src == nil {
		return time.Time{}, nil
	}
	switch v := src.(type) {
	case time.Time:
		return v.UTC(), nil
	case int64:
		return unixGuess(v), nil
	case int32:
		return time.Unix(int64(v), 0).UTC(), nil
	case uint64:
		return unixGuess(int64(v)), nil
	case float64:
		return unixGuess(int64(v)), nil
	case []byte:
		return parseDBTime(string(v))
	case string:
		if v == "" {
			return time.Time{}, nil
		}
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return unixGuess(n), nil
		}
		layouts := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02 15:04:05",
			"2006-01-02 15:04:05.000",
			"2006-01-02 15:04:05.000000",
		}
		for _, layout := range layouts {
			if t, err := time.ParseInLocation(layout, v, time.UTC); err == nil {
				return t.UTC(), nil
			}
		}
		return time.Time{}, fmt.Errorf("cannot parse time %q", v)
	default:
		return time.Time{}, fmt.Errorf("cannot scan time from %T", src)
	}
}

func unixGuess(n int64) time.Time {
	if n <= 0 {
		return time.Time{}
	}
	if n > 1e12 {
		return time.UnixMilli(n).UTC()
	}
	return time.Unix(n, 0).UTC()
}
