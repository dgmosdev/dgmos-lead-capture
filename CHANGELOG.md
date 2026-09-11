# Changelog

## 1.2.0 — saved leads list + status

- **List first, enrich later:** scan saves skeletons immediately; ban-safe background enrich starts after a delay (`backgroundEnrichDelayMinutes`), not during the scan
- **GET `/v1/leads`** cursor pagination, filters (`enrich_status`, `ai_status`, `q`), totals
- **PATCH `/v1/leads/{id}`** for host AI / enrich status updates
- Auto `enrich_status`: `listed` → `enriched` when detail fields land on upsert
- Extension **Saved leads** page (`leads.html`) with badges + background enrich status
- Popup: workspace “Saved leads” + post-import link to full list
- Host Contract / OpenAPI updated; DB migration `002_lead_status`
- **Feature gates:** `aiProvider`, `inlineEnrichDuringScan` (default off), `backgroundEnrichListed` (default on)

## 1.1.0 — product-ready kit

- White-label `LI_IMPORT_CONFIG` drives brand, API bases, token prefix, storage keys, limits
- Host Contract `/v1/*` (+ `/extension/*` aliases); session uses `workspace_*` (temporary `organization_*` alias)
- Reference API split into `internal/{httpapi,store,auth,leads,config}`; migrate, rate limit, structured logs, prod admin-key guard
- Extension: config wiring, cancel scrape, clearer auth/network errors, CSV as safe path
- Kit DB tutmaz / dayatmaz — BYO database (Host Contract = ürün yüzeyi; Compose Postgres = opsiyonel demo)
- **Ban-safe enrich queue:** list → skeleton save → batches (`enrichBatchSize`) + jitter pauses + session/daily caps; challenge hard-stop
- **Two-phase LinkedIn import:** list all → then sequential profile enrich; toggle via `enrichProfiles`
- Docs: HOST_CONTRACT, OpenAPI, INTEGRATION, OPERATOR; CI; package zip script
- No AI score / upstream SaaS dependency

## 1.0.0

- Initial LinkedIn import extension + Go API + Postgres package
