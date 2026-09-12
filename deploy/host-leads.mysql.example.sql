-- Host-owned example. Sidecar does not run this.
-- Yeni leads + extension_tokens tablosu.
-- MySQL 8 / InnoDB / utf8mb4_turkish_ci
-- id: BIGINT AUTO_INCREMENT (sidecar id göndermez)
-- timestamps: Unix epoch seconds (BIGINT)
-- soft delete: deleted_at NULL = aktif

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  create_user_id BIGINT NOT NULL,
  create_customer_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  company VARCHAR(255) NULL,
  location VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(500) NULL,
  headline VARCHAR(512) NULL,
  about TEXT NULL,
  profile_url VARCHAR(500) NOT NULL,
  linkedin_url VARCHAR(500) NULL,
  enrich_status ENUM('listed', 'enriched') NOT NULL DEFAULT 'listed',
  ai_status ENUM('none', 'pending', 'done', 'skipped') NOT NULL DEFAULT 'none',
  metadata JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_profile (create_customer_id, profile_url),
  KEY idx_customer_updated (create_customer_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;

CREATE TABLE IF NOT EXISTS extension_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  create_user_id BIGINT NOT NULL,
  create_customer_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),
  KEY idx_token_customer (create_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
