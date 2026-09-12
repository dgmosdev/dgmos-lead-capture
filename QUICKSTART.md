# Quickstart — Dgmos Lead Capture

Eklenti LinkedIn’den toplar; sidecar host MySQL `leads` tablosuna yazar.

```
Chrome eklentisi  →  http://127.0.0.1:8088  →  MySQL
```

## 1. Demo’yu aç

Docker gerekir.

```bash
npm run demo:up
curl http://127.0.0.1:8088/v1/health
```

`{"status":"ok"}` gelmeli.  
Acme örnek: user `7`, customer `1`. MySQL `127.0.0.1:3307`.

## 2. Token üret

```bash
curl -sS -X POST http://127.0.0.1:8088/v1/tokens \
  -H 'X-Admin-Key: demo-admin-key' \
  -H 'Content-Type: application/json' \
  -d '{"label":"Ahmet","create_user_id":7,"create_customer_id":1}'
```

Yanıttaki `secret` (`dgext_…`) bir kez görünür. Sakla.

## 3. Eklentiyi yükle

```bash
node scripts/apply-config.mjs
```

1. Chrome → `chrome://extensions`
2. Developer mode açık
3. **Load unpacked** → `extension/`
4. Side panel’i aç, token’ı yapıştır
5. API URL: `http://localhost:8088`

## 4. LinkedIn’den kaydet

LinkedIn’de oturum açık olsun.

| Sayfa | Ne olur |
|-------|---------|
| Search / people | Liste → `leads` (`listed`) |
| Connections | Aynı |
| Profil | Detay merge (`enriched`) |
| Connections.csv | İçeri aktar |

Kayıtlar: eklenti **Saved leads** veya `GET /v1/leads` (Bearer token).

## 5. Test

```bash
npm test              # birim (eklenti + Go)
npm run smoke         # demo ayaktaysa canlı API
npm run demo:smoke    # demo aç + canlı test
```

## 6. Kapat

```bash
npm run demo:down
```

---

## Kendi CRM’ine bağlamak

Demo değil, host DB kullanacaksan:

1. `deploy/host-leads.mysql.example.sql` uygula (`leads` + `extension_tokens`). Sidecar tablo **yaratmaz**.
2. `.env` — `DATABASE_URL`, `ADMIN_KEY`, `MAPPING_FILE`
3. `deploy/mapping.mysql.host.yaml` kolon adlarını host’a göre düzelt
4. `docker compose up --build -d`
5. `POST /v1/tokens` ile gerçek `create_user_id` / `create_customer_id`
6. Eklenti `prodApiBase` = sidecar URL

Tenant kolonu `workspace_id` ise: `deploy/mapping.workspace.example.yaml`.

Sözleşme: [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) · ayrıntı: [README.md](README.md)
