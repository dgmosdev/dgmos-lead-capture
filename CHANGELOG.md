# Changelog

## 1.1.0 — product-ready kit

- White-label `LI_IMPORT_CONFIG` drives brand, API bases, token prefix, storage keys, limits
- Host Contract `/v1/*` (+ `/extension/*` aliases); session uses `workspace_*` (temporary `organization_*` alias)
- Reference API split into `internal/{httpapi,store,auth,leads,config}`; migrate, rate limit, structured logs, prod admin-key guard
- Extension: config wiring, cancel scrape, clearer auth/network errors, CSV as safe path
- Kit DB tutmaz / dayatmaz — BYO database (Host Contract = ürün yüzeyi; Compose Postgres = opsiyonel demo)
- **Two-phase LinkedIn import:** list all → then sequential profile enrich; toggle via `enrichProfiles`
- Docs: HOST_CONTRACT, OpenAPI, INTEGRATION, OPERATOR; CI; package zip script
- No AI score / upstream SaaS dependency

## 1.0.0

- Initial LinkedIn import extension + Go API + Postgres package
