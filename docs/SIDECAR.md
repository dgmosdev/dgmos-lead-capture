# Sidecar

Image yalnızca HTTP + SQL eşlemesi. `CREATE TABLE` yok.

```
extension → Bearer → linkedin-import → mapping.yaml → host MySQL/Postgres
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

Kolon adları mapping ile. Host yeni `leads` tablosunu açar; sidecar tablo yaratmaz.

`SCHEMA_CHECK=true` (varsayılan): mapped kolon host’ta yoksa süreç açılmaz.
