# Dgmos backend — Docker sidecar

Sunucuya `git clone` yok. Dgmos backend ekstra paket indirmez.  
Compose’a **bir servis** eklenir: image + env + aynı MySQL.

```
Eklenti  →  lead-capture:8088  →  Dgmos MySQL (leads)
```

Sidecar tablo yaratmaz. SQL Dgmos migration’ında durur.

---

## Dgmos tarafında duran 3 şey

1. Migration: `leads` + `extension_tokens` (SQL’i kendi `migrations/` klasörüne koy)
2. Compose servisi `lead-capture` (`image: ghcr.io/dgmosdev/lead-capture:1.3.0`)
3. `.env` → `LEAD_CAPTURE_ADMIN_KEY`

Mapping dosyası yok: kolonlar `create_user_id` / `create_customer_id` ise built-in default yeter.

---

## 1. Image

`dgmos-lead-capture:1.3.0` Docker Hub’da yok — çekilmez.

Canlı adres:

```text
ghcr.io/dgmosdev/lead-capture:1.3.0
```

`main`’e push olunca CI buraya basar. İlk sefer GitHub → Packages → `lead-capture` → Public yap (yoksa sunucu `docker pull` için login ister).

```bash
docker pull ghcr.io/dgmosdev/lead-capture:1.3.0
```

---

## 2. SQL — Dgmos migration

`deploy/host-leads.mysql.example.sql` içeriğini Dgmos migration’ına kopyala, bir kez uygula.

`leads`’e `users` / `customers` FK koyma.

```sql
SHOW TABLES LIKE 'leads';
SHOW TABLES LIKE 'extension_tokens';
```

---

## 3. Compose

`deploy/compose.lead-capture.snippet.yml` bloğunu Dgmos `docker-compose.yml` `services:` altına yapıştır.  
MySQL servis adı sende farklıysa `depends_on` ve `DATABASE_URL` host’unu düzelt (`mysql`).

`.env`:

```bash
LEAD_CAPTURE_ADMIN_KEY=uzun-rastgele-string
```

```bash
docker compose up -d lead-capture
curl -sS http://127.0.0.1:8088/v1/health
```

`{"status":"ok"}`. `SCHEMA_CHECK` patlarsa kolonlar SQL ile default mapping aynı değil.

---

## 4. Token

```bash
curl -sS -X POST http://127.0.0.1:8088/v1/tokens \
  -H "X-Admin-Key: $LEAD_CAPTURE_ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Ahmet","create_user_id":7,"create_customer_id":1}'
```

`create_user_id` / `create_customer_id` = senin Dgmos user + customer id.  
`secret` (`dgext_…`) bir kez gelir. 8088’i public açma.

---

## 5. Eklenti

İlk gün tünel:

```bash
ssh -N -L 8088:127.0.0.1:8088 kullanici@SUNUCU
```

`config.js` → `http://localhost:8088` → `node scripts/apply-config.mjs`  
Chrome Load unpacked → `extension/` → token.

Kalıcı: Nginx `/lead-capture/` → `prodApiBase` + tekrar apply-config.

---

## 6. Takılma

| Belirti | Ne bak |
|---------|--------|
| health `db_unavailable` | `DATABASE_URL` compose içi MySQL hostname |
| süreç çıkıyor | tablolar yok / kolon adı farklı |
| `ADMIN_KEY must be set` | production’da zayıf key |
| `Failed to fetch` | tünel kapalı veya origin manifest’te yok |

Sözleşme: [HOST_CONTRACT.md](./HOST_CONTRACT.md)
