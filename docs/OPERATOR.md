# Operator guide

## Stack

- Chrome MV3 extension (`extension/`)
- Reference Go API (`api/`) on `:8088`
- Postgres 16 (`docker compose`)

## Start

```bash
cp .env.example .env
# set ADMIN_KEY to a strong value before production
docker compose up --build -d
curl -s http://localhost:8088/v1/health
./scripts/bootstrap-token.sh
```

## Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres DSN |
| `HTTP_ADDR` | Listen addr (default `:8088`) |
| `ADMIN_KEY` | Admin routes; refused in `ENV=production` if empty/`change-me*` |
| `WORKSPACE_ID` / `WORKSPACE_NAME` | Single workspace |
| `TOKEN_PREFIX` | Must match extension `tokenPrefix` (`dgext_`) |
| `CORS_ORIGIN` | Prefer specific origin in prod; `*` logs a warning |
| `ENV` | `production` enables admin key strictness |

## Tokens

- Create: `POST /admin/bootstrap-token` or `POST /v1/tokens`
- List: `GET /v1/tokens`
- Revoke: `DELETE /v1/tokens/{id}`
- UI helper: open `admin/index.html` while API is up

Secrets are shown once. Stored as SHA-256 hashes.

## Backup

```bash
docker compose exec db pg_dump -U dgmos dgmos_leads > backup.sql
```

Restore into a fresh volume with `psql`.

## Extension package

```bash
npm run package
# → dist/linkedin-import-extension-1.1.0.zip
```

## LinkedIn risk

Automated scrolling **and sequential profile opens** may violate LinkedIn Terms of Service and can trigger challenges or restrictions. Operators accept this risk.

Default flow: **list first, then enrich one-by-one** (`enrichProfiles: true` in `extension/config.js`). Turn off enrich or lower `limits.enrichMax` / raise `enrichPauseMs` to reduce risk. Prefer **Connections.csv** when deep profile visits are not required.

## Health / rate limit

- `/v1/health` pings the database
- ~60 requests/minute per token (in-memory)
