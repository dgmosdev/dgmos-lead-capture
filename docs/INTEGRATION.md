# Integration (≈15 minutes)

Wire the Chrome extension to your own Host API (or the reference Go API).

## 1. Implement Host Contract

Expose at minimum:

- `GET /v1/session` → `{ workspace_id, workspace_name, providers: ["linkedin"] }`
- `POST /v1/leads` → validate + upsert; return `{ created, merged, skipped }`
- `GET /v1/health` (DB ping)

Details: [HOST_CONTRACT.md](./HOST_CONTRACT.md), [openapi.yaml](./openapi.yaml).

Optional aliases: `/extension/session`, `/extension/leads`.

## 2. Brand the extension

Edit only:

1. `extension/config.js` — `brandName`, `brandTag`, `tagline`, `tokenPrefix`, `prodApiBase`, `storagePrefix`, colors
2. `extension/icons/*` (optional)
3. Run `node scripts/apply-config.mjs` to sync `manifest.json` host_permissions

Token prefix in your API must match `tokenPrefix` (default `dgext_`).

## 3. Issue a token

Reference API:

```bash
docker compose up --build -d
./scripts/bootstrap-token.sh
```

Or `POST /admin/bootstrap-token` with `X-Admin-Key`.

## 4. Load extension

1. `chrome://extensions` → Developer mode → Load unpacked → `extension/`
2. Paste token, set API URL to your host, Connect

## 5. Smoke test

```bash
TOKEN=dgext_…
curl -s "$API/v1/session" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$API/v1/leads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"linkedin","leads":[{"name":"Test","profile_url":"https://www.linkedin.com/in/test"}]}'
```

On LinkedIn: Connections, Search, or **Connections.csv** → Save.

## Notes

- Scope is capture + save. Default: list all leads, then open profiles sequentially for details (`enrichProfiles`).
- Hosts may still add server-side enrichment; kit does DOM enrich in the browser tab.
- Prefer CSV when you do not need live profile visits.
