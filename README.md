# Dgmos LinkedIn Import

Bağımsız paket: LinkedIn’den lead çek → Dgmos API’ye kaydet.

**Kapsam:** çek + kaydet. AI / enrich / outreach / Custfind **yok**.

```
LinkedIn (tarayıcı)
  → Dgmos Chrome Extension
    → Dgmos API (:8088)
      → Postgres
```

## Hızlı kurulum

```bash
cd dgmos-linkedin-import
cp .env.example .env
# ADMIN_KEY değerini değiştir
docker compose up --build -d
```

API: http://localhost:8088/healthz  
Postgres: localhost:5433

## Token oluştur

```bash
./scripts/bootstrap-token.sh
# veya
curl -s -X POST http://localhost:8088/admin/bootstrap-token \
  -H "X-Admin-Key: change-me-admin-key"
```

İstersen `admin/index.html` dosyasını tarayıcıda aç (API ayaktayken) — UI ile token üret.

### Extension yükle

1. Chrome → `chrome://extensions` → **Developer mode**
2. **Load unpacked** → `dgmos-linkedin-import/extension`
3. Popup → token yapıştır → API URL `http://localhost:8088` → Connect

### Kullanım

| Yol | Ne yapar |
|-----|----------|
| Connections | LinkedIn bağlantı listesini kaydırır, kaydeder |
| Search / Sales Nav / People | Arama veya şirket People sonuçlarını alır |
| Connections.csv | LinkedIn Data export CSV (en güvenli) |

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/healthz` | — |
| GET | `/extension/session` | Bearer `dgext_…` |
| POST | `/extension/leads` | Bearer `dgext_…` (max 100/batch) |
| GET/POST | `/extension/tokens` | `X-Admin-Key` |
| DELETE | `/extension/tokens/{id}` | `X-Admin-Key` |
| POST | `/admin/bootstrap-token` | `X-Admin-Key` |

Lead alanları: `name`, `profile_url` / `linkedin_url`, `title`, `company`, `location`, `email`, `phone`, `website`, `headline`, `about`.

Aynı `profile_url` → upsert (merge).

## Ortam değişkenleri

`.env.example` dosyasına bak. Prod’da:

- `ADMIN_KEY` güçlü olsun  
- `DATABASE_URL` Dgmos Postgres  
- Extension `host_permissions` içine kendi API domain’ini ekle  
- Popup’ta API URL’yi prod adresine çevir  

## Yerel API (Docker’suz)

```bash
# Postgres 5433 ayakta olsun (docker compose up db -d)
cd api
go run ./cmd
```

## Test

```bash
# Extension unit (CSV / URL helpers)
cd extension && node --test providers/linkedin/core.test.js providers/linkedin/csv.test.js

# API build
cd api && go build -o /tmp/dgmos-api ./cmd
```

## Dizin

```
dgmos-linkedin-import/
  extension/     Chrome MV3 (Dgmos marka)
  api/           Go HTTP API
  sql/schema.sql
  docker-compose.yml
  .env.example
  README.md
```

## Notlar

- Custfind’e ağ çağrısı yok.
- LinkedIn ToS / hesap riski Dgmos’un sorumluluğunda; büyük ağlar için CSV önerilir.
- Version **1.0.0**
