# Host Contract

LinkedIn Import Kit eklentisi host backend’e yalnızca `apiBase` + Bearer token ile bağlanır.
Host bu sözleşmeyi implement eder; referans Go API aynı yüzeyi sağlar.

JSON alanları **snake_case**.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/v1/health` | — | DB ping; alias `/healthz` |
| GET | `/v1/session` | Bearer | Workspace + providers |
| POST | `/v1/leads` | Bearer | Upsert batch (max 100) |
| GET | `/v1/tokens` | `X-Admin-Key` | List tokens (reference API) |
| POST | `/v1/tokens` | `X-Admin-Key` | Create token |
| DELETE | `/v1/tokens/{id}` | `X-Admin-Key` | Revoke token |
| POST | `/admin/bootstrap-token` | `X-Admin-Key` | One-shot bootstrap secret |

**Compatibility aliases:** `/extension/session`, `/extension/leads`, `/extension/tokens` → same handlers.

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
  "organization_id": "11111111-1111-1111-1111-111111111111",
  "organization_name": "Dgmos"
}
```

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

## Errors

```json
{ "error": "unauthorized" }
```

Common codes: `unauthorized`, `invalid_json`, `leads_required`, `maximum_100_leads`, `unsupported_provider`, `rate_limited`, `db_unavailable`.

## Auth

- Extension tokens: Bearer, prefix from host config (default `dgext_`)
- Admin routes: header `X-Admin-Key`

See also: [openapi.yaml](./openapi.yaml), [INTEGRATION.md](./INTEGRATION.md).
