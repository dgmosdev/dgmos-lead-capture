# Integration (≈15 minutes)

Extension → senin Host API’n. **Veritabanı host’a aittir** (Postgres, MySQL, başka ne varsa). Bu kit DB şeması veya motoru dayatmaz.

```
Extension  --Bearer-->  Senin /v1/* API  -->  Senin DB
```

Referans Go API + Compose Postgres isteğe bağlı demo; prod için zorunlu değil.

## 1. Implement Host Contract

Minimum:

- `GET /v1/session` → `{ workspace_id, workspace_name, providers: ["linkedin"] }`
- `POST /v1/leads` → validate + upsert; `{ created, merged, skipped }` (auto `enrich_status`)
- `GET /v1/leads` → saved list + totals (`enrich_status` / `ai_status`) for the extension leads page
- `PATCH /v1/leads/{id}` → host sets `ai_status` after AI pipeline (`none|pending|done|skipped`)
- `GET /v1/health` → servis ayakta (istersen kendi DB ping’in)

Detay: [HOST_CONTRACT.md](./HOST_CONTRACT.md), [openapi.yaml](./openapi.yaml).

Lead’leri nereye yazacağın (tablo, MySQL vs Postgres, multi-tenant) tamamen senin tasarımın. Contract yalnızca HTTP JSON.

Opsiyonel alias: `/extension/session`, `/extension/leads`.

## 2. Brand the extension

1. `extension/config.js` — `brandName`, `prodApiBase`, `tokenPrefix`, …
2. `extension/icons/*` (opsiyonel)
3. `node scripts/apply-config.mjs`

Token prefix API ile aynı olmalı (varsayılan `dgext_`).

## 3. Token

Kendi admin/auth akışınla Bearer secret üret **veya** referans demo için:

```bash
docker compose up --build -d   # sadece demo
./scripts/bootstrap-token.sh
```

## 4. Load extension

1. Load unpacked → `extension/`
2. API URL = senin host’un → Connect

## 5. Smoke

```bash
curl -s "$API/v1/session" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$API/v1/leads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"linkedin","leads":[{"name":"Test","profile_url":"https://www.linkedin.com/in/test"}]}'
```

## Notes

- Ürün yüzeyi = Host Contract; DB = BYO.
- Varsayılan eklenti akışı (ban-safe): liste → iskelet API kaydı → küçük batch enrich + jitter/mola + session/daily cap.
- CSV: canlı profil gezmeden import.
