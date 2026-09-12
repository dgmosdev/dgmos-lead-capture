# Dgmos Lead Capture

Tarayıcı eklentisi profilleri toplar; **host CRM veritabanına** yazar.  
AI, outreach ve faturalama yok — host’ta kalır.

```
Eklenti (Side Panel)  --Bearer-->  Lead Capture sidecar  --mapping.yaml-->  host MySQL
```

Tablolar bu repoda yok. Image `CREATE TABLE` çalıştırmaz. **Oto migrate yok.**

## Şema — sen uygularsın

Sidecar DB’ye bağlanınca tablo yaratmaz. Sıra:

1. Host’ta `leads` + `extension_tokens` aç. Örnek: `deploy/host-leads.mysql.example.sql`  
   Bunu kendi migration’ına koy (`migrations/…`) veya bir kez `mysql < dosya` çalıştır.
2. Sidecar’ı başlat. `SCHEMA_CHECK=true` (varsayılan) mapped kolon yoksa **açılmaz**, şema düzeltmez.
3. Kolonlar varsa HTTP dinler.

```
Host migration (sen)  →  tablolar hazır
Sidecar start         →  ping + SCHEMA_CHECK  →  INSERT/UPDATE
```

`SCHEMA_CHECK=false` kontrolü atlar; tablo yoksa ilk istek patlar. Production’da açık bırak.

Demo (`examples/host-demo`) istisna: MySQL `init/*.sql` ile şemayı konteyner yükler — yine sidecar değil.

`leads`’e user/customer FK koyma. Sidecar o satırları yaratmaz; INSERT patlar.

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

Image adı: `dgmos-lead-capture` (servis: `lead-capture`). Registry’de yayın yok; host `build` eder.

```bash
cp .env.example .env
# DATABASE_URL, ADMIN_KEY, MAPPING_FILE
docker compose up --build -d
# veya: docker build -t dgmos-lead-capture:1.3.0 ./api
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

Birim (eklenti + Go). LinkedIn fixture: search / connections / profil / şirket + CSV → API payload:

```bash
npm test
```

Canlı demo (Acme MySQL + sidecar). Auth + LinkedIn search/profil/CSV/şirket → `leads` kaydı:

```bash
npm run demo:smoke
```

Demo zaten ayaktaysa: `npm run smoke`  
Kapat: `npm run demo:down`
