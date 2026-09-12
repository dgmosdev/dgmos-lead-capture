# LinkedIn Import

Chrome eklentisi LinkedIn’den lead çeker; **senin DB’ne** yazar.  
AI, outreach, billing yok — host’ta kalır.

```
Extension (Side Panel)  --Bearer-->  sidecar image  --mapping.yaml-->  host DB
```

Tablolar bu repoda yok. Image tablo yaratmaz.

## Parçalar

| Parça | Dağıtım |
|-------|---------|
| Chrome extension | Store / zip — `extension/` |
| Sidecar API | Docker — host Compose’una ekle |
| Host DB | Senin şeman + `deploy/mapping.example.yaml` |

## Sidecar

```bash
cp .env.example .env
# DATABASE_URL ve ADMIN_KEY
# mapping.yaml → kendi tablo/kolon adların
docker compose up --build -d
```

- `GET /v1/health`
- `POST /v1/tokens` (`X-Admin-Key`, `create_user_id`, `create_customer_id`)
- Eklenti: `prodApiBase` + Bearer

Sözleşme: [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) · eşleme: [docs/SIDECAR.md](docs/SIDECAR.md)

## Extension

```bash
# extension/config.js → prodApiBase, brandName
node scripts/apply-config.mjs
# chrome://extensions → Load unpacked → extension/
npm run package
```

Search / connections / CSV → kaydet → ban-safe background enrich → Saved leads.

## Test

```bash
npm test
```
