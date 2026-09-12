# Host Contract

Eklenti yalnızca `apiBase` + Bearer ile bağlanır. JSON **snake_case**.

Şema host’ta. Sidecar `MAPPING_FILE` ile yazar. Detay: [SIDECAR.md](./SIDECAR.md).

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/v1/health` | — | DB ping; alias `/healthz` |
| GET | `/v1/session` | Bearer | workspace + `features` |
| POST | `/v1/leads` | Bearer | Upsert batch (max 100) |
| GET | `/v1/leads` | Bearer | Liste + totals |
| PATCH | `/v1/leads/{id}` | Bearer | `enrich_status` / `ai_status` |
| GET | `/v1/tokens` | `X-Admin-Key` | Token listesi |
| POST | `/v1/tokens` | `X-Admin-Key` | Token + `create_user_id` / `create_customer_id` |
| DELETE | `/v1/tokens/{id}` | `X-Admin-Key` | İptal |

## Session

```http
GET /v1/session
Authorization: Bearer dgext_…
```

```json
{
  "workspace_id": "42",
  "workspace_name": "Dgmos",
  "providers": ["linkedin"],
  "features": {
    "ai": false,
    "ai_provider": null
  }
}
```

`workspace_id` = token’daki `create_customer_id` (BIGINT, JSON string). UUID değil.

`features` (optional): `ai` / `ai_provider` / `enrich`. Eklenti `skipEnrichWithoutAi` ile birlikte okur.

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
      "id": "1",
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
- `POST /v1/tokens` body: `create_user_id` ve `create_customer_id` zorunlu (sayı, `"123"` veya `123`). Sidecar UUID yazmaz.

See also: [openapi.yaml](./openapi.yaml), [SIDECAR.md](./SIDECAR.md).
