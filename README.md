# LinkedIn Import Kit

Bağımsız paket: LinkedIn’den lead çek → Host API’ye kaydet (upsert).

**Kapsam:** çek + kaydet. AI score / enrich kuyruğu / outreach / upstream SaaS **yok**.

```
LinkedIn (tarayıcı)
  → Chrome Extension (white-label)
    → Host API (/v1/*)  veya  referans Go API (:8088)
      → Postgres
```

Varsayılan marka: **Dgmos** (`extension/config.js`).

## 5 dk kurulum

```bash
cp .env.example .env
# ADMIN_KEY değerini değiştir
docker compose up --build -d
./scripts/bootstrap-token.sh
```

API: http://localhost:8088/v1/health  
Postgres: localhost:5433

### Extension yükle

1. `node scripts/apply-config.mjs` (manifest host_permissions)
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension/`
3. Popup → token yapıştır → API URL `http://localhost:8088` → Connect

### Kullanım

| Yol | Ne yapar |
|-----|----------|
| Connections | Bağlantı listesini kaydırır, kaydeder |
| Search / Sales Nav / People | Arama veya şirket People sonuçlarını alır |
| Connections.csv | LinkedIn Data export CSV (**önerilen güvenli yol**) |

## White-label

Yalnızca şunları değiştir:

1. `extension/config.js` (`brandName`, `prodApiBase`, `tokenPrefix`, …)
2. İkonlar (`extension/icons/`)
3. `node scripts/apply-config.mjs`

## Host Contract

Eklenti sadece `apiBase` + Bearer token kullanır. Host [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) ve [docs/openapi.yaml](docs/openapi.yaml) uygular.

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` (alias `/healthz`) | — |
| GET | `/v1/session` | Bearer |
| POST | `/v1/leads` | Bearer (max 100/batch) |
| GET/POST | `/v1/tokens` | `X-Admin-Key` |
| DELETE | `/v1/tokens/{id}` | `X-Admin-Key` |
| POST | `/admin/bootstrap-token` | `X-Admin-Key` |

Geriye uyum: `/extension/session`, `/extension/leads`.

Session: `workspace_id`, `workspace_name` (+ geçici `organization_*` alias).

## Ortam değişkenleri

`.env.example` — prod’da `ADMIN_KEY` güçlü olsun, `ENV=production`, `CORS_ORIGIN` spesifik, `TOKEN_PREFIX` eklenti ile uyumlu (`dgext_`).

## Test / paket

```bash
npm test
npm run package   # dist/linkedin-import-extension-1.1.0.zip
```

## Dizin

```
linkedin-import/
  extension/     Chrome MV3
  api/           Referans Go API (internal katmanlar)
  sql/schema.sql
  docs/          HOST_CONTRACT, OpenAPI, INTEGRATION, OPERATOR
  docker-compose.yml
```

## Notlar

- Upstream SaaS / AI bağımlılığı yok; ağ çağrıları yalnızca yapılandırılan Host API’ye gider.
- LinkedIn ToS / hesap riski operatörün sorumluluğunda; büyük ağlar için CSV önerilir.
- Sürüm **1.1.0** — [CHANGELOG.md](CHANGELOG.md), lisans: [LICENSE](LICENSE) (proprietary).
