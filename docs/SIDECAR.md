# Capture sidecar

Image yalnızca HTTP + SQL eşlemesi. `CREATE TABLE` yok.

```
extension → Bearer → dgmos-capture → mapping.yaml → host MySQL/Postgres
```

## Compose

Bu reponun `docker-compose.yml` dosyası sidecar’dır. Host’un `DATABASE_URL`’ini ver, `mapping.yaml` mount et.

## Auth

Ürün yolu: `token_table` + `extension_tokens`. `header` / `jwt` kodda durur, bu host için kullanılmaz.

Token örneği:

```http
POST /v1/tokens
X-Admin-Key: …
{ "label": "Ahmet", "create_user_id": "…", "create_customer_id": "…" }
```

## Yeni tablo sözleşmesi

Sidecar yeni `leads` tablosuna yazar. Ayar yok, sabit:

- `id` — host `BIGINT AUTO_INCREMENT`, sidecar id göndermez
- `created_at` / `updated_at` / `deleted_at` — Unix epoch saniye (`UNIX_TIMESTAMP()`)
- soft delete — `deleted_at IS NULL`

MySQL DSN: `charset=utf8mb4` varsayılan. Türkçe collation için `DATABASE_URL`’e `&collation=utf8mb4_turkish_ci` ekleyin.

HTTP JSON’da `id` string, tarihler RFC3339. BIGINT id `"42"` olarak döner.

## İzolasyon

Tenant mantıksal alanı `create_customer_id`. Fiziksel kolon host’a göre:

```yaml
# Bu proje (Acme): customer + user
create_customer_id: create_customer_id
create_user_id: create_user_id

# Başka proje: workspace + user
create_customer_id: workspace_id
create_user_id: user_id

# Sadece workspace (user yok)
create_customer_id: workspace_id
create_user_id: ""
```

Aynı fiziksel kolona iki mantıksal alan bağlanmaz. Token body alias: `workspace_id` → customer, `user_id` → user.

Host yeni tabloyu açar; sidecar tablo yaratmaz.

`SCHEMA_CHECK=true` (varsayılan): mapped kolon host’ta yoksa süreç açılmaz.
