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

	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Error("config invalid", "error", err)
		os.Exit(1)
	}
	if cfg.CORSOrigin == "*" {
		log.Warn("CORS_ORIGIN=* — prefer a specific origin in production")
	}

	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	if err := st.EnsureWorkspace(ctx, cfg.WorkspaceID, cfg.WorkspaceName); err != nil {
		log.Error("workspace", "error", err)
		os.Exit(1)
	}

	srv := httpapi.New(cfg, st, log)
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Info("linkedin-import api listening",
		"addr", cfg.HTTPAddr,
		"workspace", cfg.WorkspaceName,
		"env", cfg.Env,
	)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
