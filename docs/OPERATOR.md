# Operator guide

## Ürün vs referans

| Parça | Rol |
|-------|-----|
| Extension zip | Dağıtılan istemci |
| Host Contract | Host’un implement ettiği yüzey |
| Host DB | **BYO** — Postgres / MySQL / … host seçer |
| `docker compose` + referans Go API | Opsiyonel demo / self-host örneği |

Prod’da çoğu ekip kendi API + kendi DB kullanır; Compose zorunlu değildir.

## Referans demo stack (opsiyonel)

- Go API (`api/`) `:8088`
- Örnek Postgres 16 (Compose volume) — **örnek depo**, ürün zorunluluğu değil

```bash
cp .env.example .env
docker compose up --build -d
curl -s http://localhost:8088/v1/health
./scripts/bootstrap-token.sh
```

Kendi Postgres’ine bağlamak istersen (yine referans API): Compose `db` servisini kapatıp `DATABASE_URL`’i kendi DSN’ine ver.

## Environment (referans API)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Referans API’nin Postgres DSN’i |
| `HTTP_ADDR` | Listen (default `:8088`) |
| `ADMIN_KEY` | Admin routes; `ENV=production` iken `change-me*` refuse |
| `WORKSPACE_ID` / `WORKSPACE_NAME` | Tek workspace |
| `TOKEN_PREFIX` | Extension `tokenPrefix` ile aynı |
| `CORS_ORIGIN` | Prod’da spesifik origin |
| `ENV` | `production` sertleştirme |

Kendi host implementasyonunda bu env’ler geçerli olmayabilir; kendi config’ini kullanırsın.

## Tokens (referans API)

- `POST /admin/bootstrap-token` / `POST /v1/tokens`
- `GET /v1/tokens`, `DELETE /v1/tokens/{id}`
- UI: `admin/index.html`

Kendi host’unda token’ı kendi auth sisteminle üretirsin.

## Backup (yalnızca demo Postgres)

```bash
docker compose exec db pg_dump -U dgmos dgmos_leads > backup.sql
```

Prod BYO DB için kendi yedek politikan geçerli.

## Extension package

```bash
npm run package
```

## LinkedIn risk

Liste kaydırma + sıralı profil açma ToS / hesap riski taşır. `enrichProfiles`, `enrichMax`, `enrichPauseMs` ile ayarla. CSV daha güvenli yol.

## Health / rate limit (referans)

- `/v1/health` — referans API DB ping eder; kendi host’unda health tanımın serbest
- ~60 req/dk / token (referans, in-memory)
