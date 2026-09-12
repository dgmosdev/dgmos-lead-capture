package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/dgmos/linkedin-import/internal/config"
	"github.com/dgmos/linkedin-import/internal/httpapi"
	"github.com/dgmos/linkedin-import/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg, err := config.Load()
	if err != nil {
		log.Error("config invalid", "error", err)
		os.Exit(1)
	}
	if err := cfg.Validate(); err != nil {
		log.Error("config invalid", "error", err)
		os.Exit(1)
	}
	if cfg.CORSOrigin == "*" {
		log.Warn("CORS_ORIGIN=* — prefer a specific origin in production")
	}

	ctx := context.Background()
	st, err := store.New(ctx, store.Options{
		DatabaseURL: cfg.DatabaseURL,
		Mapping:     cfg.Mapping,
		SchemaCheck: cfg.SchemaCheck,
	})
	if err != nil {
		log.Error("db connect", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	srv := httpapi.New(cfg, st, log)
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Info("capture api listening",
		"addr", cfg.HTTPAddr,
		"name", cfg.DisplayName,
		"env", cfg.Env,
		"auth_mode", cfg.Mapping.AuthMode(),
	)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
