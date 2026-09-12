# Host Contract

LinkedIn Import Kit eklentisi host backend’e yalnızca `apiBase` + Bearer token ile bağlanır.
Host bu sözleşmeyi implement eder.

**Veritabanı contract’ın parçası değildir.** Host Postgres, MySQL veya başka bir store kullanabilir.
Referans Go API her iki motoru da destekler (`postgres://` / `mysql://`); host’lar şemayı kopyalamak zorunda değildir.
Lead satırında tenancy `workspace_id` değil `create_user_id` + `create_customer_id` (+ `deleted_at`) ile tutulur. Bu id’ler host projenin auth / müşteri modelinden gelir; kit `.env` ile dayatmaz.

JSON alanları **snake_case**.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/v1/health` | — | Servis sağlığı (host isterse DB ping); alias `/healthz` |
| GET | `/v1/session` | Bearer | Workspace + providers |
| POST | `/v1/leads` | Bearer | Upsert batch (max 100) |
| GET | `/v1/leads` | Bearer | Saved leads list (cursor + status filters) |
| PATCH | `/v1/leads/{id}` | Bearer | Update `enrich_status` / `ai_status` (host AI pipeline) |
| GET | `/v1/tokens` | `X-Admin-Key` | Opsiyonel (referans API) |
| POST | `/v1/tokens` | `X-Admin-Key` | Opsiyonel |
| DELETE | `/v1/tokens/{id}` | `X-Admin-Key` | Opsiyonel |
| POST | `/admin/bootstrap-token` | `X-Admin-Key` | Opsiyonel bootstrap |

**Compatibility aliases:** `/extension/session`, `/extension/leads`, `/extension/tokens` → same handlers.

Token/admin route’ları referans API kolaylığıdır. Kendi host’unda Bearer token’ı nasıl ürettiğin serbest; eklenti yalnızca geçerli Bearer ister.

## Session

```http
GET /v1/session
Authorization: Bearer dgext_…
```

```json
{
  "workspace_id": "11111111-1111-1111-1111-111111111111",
  "workspace_name": "Dgmos",
  "providers": ["linkedin"],
  "features": {
    "ai": false,
    "ai_provider": null
  },
  "organization_id": "11111111-1111-1111-1111-111111111111",
  "organization_name": "Dgmos"
}
```

`features` (optional):
- `ai` / `ai_provider` — AI pipeline available on host
- `enrich` — optional pin; omit to let the extension decide via `skipEnrichWithoutAi`

Extension defaults: no `aiProvider` → skip AI UI and skip profile enrich (`skipEnrichWithoutAi: true`). Set `aiProvider: "host"` or host `features.ai=true`, or `skipEnrichWithoutAi: false` / `ENRICH_ENABLED=true` to enrich without AI.

`organization_*` is a **temporary alias** for older clients. Prefer `workspace_*`.

## Leads

```http
POST /v1/leads
Authorization: Bearer dgext_…
Content-Type: application/json
```

```json
{
  "provider": "linkedin",
  "page_url": "https://www.linkedin.com/...",
  "leads": [
    {
      "name": "Ada Lovelace",
      "profile_url": "https://www.linkedin.com/in/ada",
      "title": "Engineer",
      "company": "Analytical Engines",
      "location": "London",
      "email": "ada@example.com",
      "phone": "+44…",
      "website": "https://example.com",
      "headline": "…",
      "about": "…"
    }
  ]
}
```

### Validation

- `profile_url` **or** `linkedin_url` required
- `name` **or** `company` required
- Max **100** leads per request
- Same `profile_url` → upsert / merge

### Response

```json
{ "created": 3, "merged": 1, "skipped": 0 }
```

Upsert auto-derives `enrich_status`:
- `listed` — skeleton / list fields only
- `enriched` — detail present (`about` / `email` / `phone`, or company + `website`)

`ai_status` defaults to `none`. Host AI jobs should set `pending` → `done` | `skipped` via PATCH.

## List leads

```http
GET /v1/leads?limit=40&cursor=…&enrich_status=listed&ai_status=done&q=tmgdk
Authorization: Bearer dgext_…
```

```json
{
  "items": [
    {
      "id": "…",
      "name": "Ada Lovelace",
      "profile_url": "https://www.linkedin.com/in/ada",
      "title": "Engineer",
      "company": "Analytical Engines",
      "enrich_status": "enriched",
      "ai_status": "none",
      "updated_at": "2026-09-10T12:00:00Z",
      "created_at": "2026-09-10T11:00:00Z"
    }
  ],
  "next_cursor": "…",
  "totals": {
    "all": 1000,
    "listed": 920,
    "enriched": 80,
    "ai_none": 1000,
    "ai_pending": 0,
    "ai_done": 0,
    "ai_skipped": 0
  }
}
```

## Patch lead status

```http
PATCH /v1/leads/{id}
Authorization: Bearer dgext_…
Content-Type: application/json

{ "ai_status": "done" }
```

Allowed: `enrich_status` ∈ `listed|enriched`, `ai_status` ∈ `none|pending|done|skipped`.

## Errors

```json
{ "error": "unauthorized" }
```

Common codes: `unauthorized`, `invalid_json`, `leads_required`, `maximum_100_leads`, `unsupported_provider`, `rate_limited`, `db_unavailable`, `invalid_cursor`, `invalid_status`, `not_found`.

## Auth

- Extension tokens: Bearer, prefix from host config (default `dgext_`)
- Admin routes: header `X-Admin-Key`

See also: [openapi.yaml](./openapi.yaml), [INTEGRATION.md](./INTEGRATION.md).
