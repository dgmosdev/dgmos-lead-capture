-- Postgres referans şema (Compose `db` servisi).
-- MySQL karşılığı: sql/schema.mysql.sql
-- Lead tenancy: workspace_id yok — create_user_id + create_customer_id + deleted_at.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Browser extension',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_workspace ON extension_tokens(workspace_id);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  create_user_id UUID NOT NULL,
  create_customer_id UUID NOT NULL,
  name TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  linkedin_url TEXT,
  title TEXT,
  company TEXT,
  location TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  headline TEXT,
  about TEXT,
  enrich_status TEXT NOT NULL DEFAULT 'listed'
    CHECK (enrich_status IN ('listed', 'enriched')),
  ai_status TEXT NOT NULL DEFAULT 'none'
    CHECK (ai_status IN ('none', 'pending', 'done', 'skipped')),
  source TEXT NOT NULL DEFAULT 'linkedin_extension',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (create_customer_id, profile_url)
);

CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(create_customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(create_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(create_customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_enrich ON leads(create_customer_id, enrich_status);
CREATE INDEX IF NOT EXISTS idx_leads_ai ON leads(create_customer_id, ai_status);
CREATE INDEX IF NOT EXISTS idx_leads_deleted ON leads(deleted_at);
