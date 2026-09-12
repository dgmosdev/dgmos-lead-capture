# Dgmos Capture

Tarayıcı eklentisi profilleri toplar; **host CRM veritabanına** yazar.  
AI, outreach ve faturalama yok — host’ta kalır.

```
Eklenti (Side Panel)  --Bearer-->  Capture sidecar  --mapping.yaml-->  host MySQL
```

Tablolar bu repoda yok. Image `CREATE TABLE` çalıştırmaz.

## Parçalar

| Parça | Ne |
|-------|----|
| Chrome eklentisi | `extension/` — Side Panel, LinkedIn + CSV |
| Sidecar API | Docker — host Compose’una eklenir |
| Host DB | Senin şeman + `mapping.yaml` |

Kimlik host ile aynı: `create_user_id` + `create_customer_id`. Ayrı workspace yok. Başka projede tenant `workspace_id` ise mapping ile bağlanır.

## Host entegrasyon

1. `deploy/host-leads.mysql.example.sql` uygula (`leads` + `extension_tokens`).
2. Sidecar’ı Compose’a ekle. `DATABASE_URL` aynı MySQL’e, `utf8mb4` + `utf8mb4_turkish_ci`.
3. `deploy/mapping.mysql.host.yaml` mount et (workspace’li host: `deploy/mapping.workspace.example.yaml`).
4. `ADMIN_KEY` koy. `POST /v1/tokens` ile user + customer (veya `user_id` + `workspace_id`) için token üret.
5. Eklenti: `prodApiBase` = sidecar URL, token `dgext_…`.

Sözleşme: [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) · eşleme: [docs/SIDECAR.md](docs/SIDECAR.md)

`leads`’e user/customer FK koyma. Sidecar user satırı yoksa INSERT patlar.

## Yerel demo (Acme CRM)

```bash
docker compose -f examples/host-demo/docker-compose.yml up --build -d
curl http://127.0.0.1:8088/v1/health
```

Örnek tenant: user `7`, customer `1`. Token:

```bash
curl -sS -X POST http://127.0.0.1:8088/v1/tokens \
  -H 'X-Admin-Key: demo-admin-key' \
  -H 'Content-Type: application/json' \
  -d '{"label":"Ahmet","create_user_id":7,"create_customer_id":1}'
```

Kapat: `docker compose -f examples/host-demo/docker-compose.yml down`

## Sidecar (kendi Compose)

```bash
cp .env.example .env
# DATABASE_URL, ADMIN_KEY, MAPPING_FILE
docker compose up --build -d
```

- `GET /v1/health`
- `GET /v1/session` — Bearer → `create_user_id`, `create_customer_id`
- `POST /v1/leads` — upsert (`profile_url` + customer)
- `GET /v1/leads` · `PATCH /v1/leads/{id}`
- `POST /v1/tokens` — `X-Admin-Key`

Sözleşme: BIGINT `AUTO_INCREMENT`, Unix epoch, `deleted_at IS NULL`. HTTP’de id string, tarihler RFC3339.

## Eklenti

```bash
# extension/config.js → prodApiBase, brandName
node scripts/apply-config.mjs
# chrome://extensions → Load unpacked → extension/
npm run package
```

Search / connections / CSV → kaydet → arka plan enrich → Saved leads.

## Test

```bash
npm test
```
