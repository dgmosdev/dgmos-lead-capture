# Sidecar

Image yalnızca HTTP + SQL eşlemesi. `CREATE TABLE` yok.

```
extension → Bearer → linkedin-import → mapping.yaml → host MySQL/Postgres
```

## Compose

Bu reponun `docker-compose.yml` dosyası sidecar’dır. Host’un `DATABASE_URL`’ini ver, `mapping.yaml` mount et.

## Auth

| Mode | Kimlik |
|------|--------|
| `token_table` | Host token tablosu; `create_user_id` / `create_customer_id` map et |
| `header` | Gateway `X-User-Id` / `X-Customer-Id` |
| `jwt` | HS256 claim map |

Token örneği:

```http
POST /v1/tokens
X-Admin-Key: …
{ "label": "Ahmet", "create_user_id": "…", "create_customer_id": "…" }
```

## İzolasyon

Hepsi mapping ile: ayrı database, `schema:`, `leads.table: contacts`, `name: full_name`, `table: "-"`.

`SCHEMA_CHECK=true` (varsayılan): mapped kolon host’ta yoksa süreç açılmaz.
