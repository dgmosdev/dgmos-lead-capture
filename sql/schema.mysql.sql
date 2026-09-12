-- MySQL 8+ referans şema (Compose `--profile mysql`).
-- Postgres karşılığı: sql/schema.sql
-- Lead tenancy: workspace_id yok — create_user_id + create_customer_id + deleted_at.

CREATE TABLE IF NOT EXISTS workspaces (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS extension_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  label VARCHAR(255) NOT NULL DEFAULT 'Browser extension',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  UNIQUE KEY uq_extension_tokens_hash (token_hash),
  KEY idx_extension_tokens_workspace (workspace_id),
  CONSTRAINT fk_extension_tokens_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id CHAR(36) NOT NULL PRIMARY KEY,
  create_user_id CHAR(36) NOT NULL,
  create_customer_id CHAR(36) NOT NULL,
  name VARCHAR(512) NOT NULL,
  profile_url VARCHAR(1024) NOT NULL,
  linkedin_url VARCHAR(1024) NULL,
  title VARCHAR(512) NULL,
  company VARCHAR(512) NULL,
  location VARCHAR(512) NULL,
  email VARCHAR(320) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(1024) NULL,
  headline VARCHAR(1024) NULL,
  about TEXT NULL,
  enrich_status VARCHAR(32) NOT NULL DEFAULT 'listed',
  ai_status VARCHAR(32) NOT NULL DEFAULT 'none',
  source VARCHAR(64) NOT NULL DEFAULT 'linkedin_extension',
  metadata JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_leads_customer_profile (create_customer_id, profile_url),
  KEY idx_leads_customer (create_customer_id),
  KEY idx_leads_user (create_user_id),
  KEY idx_leads_updated (create_customer_id, updated_at),
  KEY idx_leads_enrich (create_customer_id, enrich_status),
  KEY idx_leads_ai (create_customer_id, ai_status),
  KEY idx_leads_deleted (deleted_at),
  CONSTRAINT chk_leads_enrich_status CHECK (enrich_status IN ('listed', 'enriched')),
  CONSTRAINT chk_leads_ai_status CHECK (ai_status IN ('none', 'pending', 'done', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
