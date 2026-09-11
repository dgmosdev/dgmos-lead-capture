# LinkedIn Import Kit

Bağımsız ürün paketi: LinkedIn’den lead çek → **senin backend’ine** kaydet.

**Kapsam:** scrape + upsert + ban-safe background enrich + saved leads UI.  
**Kapsam dışı:** AI score, outreach, billing — bunları host backend yapar.  
**DB:** BYO (Postgres / MySQL / ne kullanıyorsan). Bu kit DB dayatmaz.

Varsayılan marka: **Dgmos** (`extension/config.js`). Sürüm **1.2.0**.

---

## Ürün mimarisi (önemli)

```
Kullanıcı Chrome’u
  └─ Extension (Side Panel)     ← Docker DEĞİL; Chrome’a kurulur
        │  Bearer token
        ▼
Senin sunucun (Docker / K8s)
  └─ Host API  /v1/*            ← ürün yüzeyi
        ▼
     Senin DB / CRM
```

| Parça | Nerede çalışır | Nasıl dağıtılır |
|-------|----------------|-----------------|
| **Chrome extension** | Kullanıcının tarayıcısı | Chrome Web Store / private zip |
| **Host API + DB** | Senin sunucun | Docker Compose / K8s / kendi stack’in |

**Tek Docker image = tüm ürün olmaz.** Extension Docker’da çalışmaz. Docker’ı **backend** için kullan.

Bu repodaki `docker compose` yalnızca **referans demo** API + Postgres’tir. Prod’da ya onu fork’larsın ya da aynı HTTP sözleşmeyi kendi dilinde yeniden yazarsın.

---

## Backend nasıl kullanır? (prod)

Hedef: eklenti lead’leri **senin API’ne** yazar; sen CRM / AI / scoring’i kendi tarafında çalıştırırsın.

### 1) Host Contract’ı implement et

Zorunlu endpoint’ler:

| Method | Path | Ne işe yarar |
|--------|------|----------------|
| `GET` | `/v1/health` | Sağlık |
| `GET` | `/v1/session` | Workspace + `features` (ai / enrich) |
| `POST` | `/v1/leads` | Upsert batch (max 100) — eklenti buraya yazar |
| `GET` | `/v1/leads` | Kayıtlı liste + totals (Saved leads UI) |
| `PATCH` | `/v1/leads/{id}` | Host AI sonrası `ai_status` / `enrich_status` |

Detay + örnek JSON: [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) · OpenAPI: [docs/openapi.yaml](docs/openapi.yaml)

Auth: eklenti yalnızca `Authorization: Bearer <token>` ister. Token’ı **sen üret** (kendi auth / admin panel). Referans API’deki `/v1/tokens` zorunlu değil.

### 2) `POST /v1/leads` — asıl entegrasyon

Eklenti şuna benzer body gönderir:

```json
{
  "provider": "linkedin",
  "page_url": "https://www.linkedin.com/search/results/people/...",
  "leads": [
    {
      "name": "Ada Lovelace",
      "profile_url": "https://www.linkedin.com/in/ada",
      "title": "Engineer",
      "company": "Analytical Engines",
      "location": "London",
      "email": "ada@example.com",
      "website": "https://example.com",
      "about": "…"
    }
  ]
}
```

Senin backend:

1. Token’dan workspace çöz
2. `profile_url` ile upsert (aynı URL → merge)
3. `{ "created": N, "merged": M, "skipped": K }` dön
4. İstersen kendi queue’na “yeni lead” event’i at (AI, enrichment, CRM sync)

Status alanları (önerilen):

- `enrich_status`: `listed` → `enriched` (detay gelince)
- `ai_status`: `none` → `pending` → `done` | `skipped` (senin AI job’ın `PATCH` ile yazar)

### 3) Extension’ı senin API’ye bağla

1. `extension/config.js` → `prodApiBase = "https://api.seninurun.com"`
2. `brandName`, `tokenPrefix`, limitler
3. `node scripts/apply-config.mjs`
4. Kullanıcıya Bearer token ver → eklentide **Connect**

White-label adımları: [docs/INTEGRATION.md](docs/INTEGRATION.md)

### 4) Veri akışı (runtime)

```
1. Kullanıcı LinkedIn’de ara / connections çek
2. Extension listeyi okur → POST /v1/leads  (iskelet, enrich_status=listed)
3. Ban-safe background enrich: profil/şirket sayfalarını yavaş ziyaret eder
4. Detay gelince tekrar POST /v1/leads  (merge → enriched)
5. Saved leads UI → GET /v1/leads
6. (Opsiyonel) Senin AI worker → PATCH /v1/leads/{id}  ai_status=done
```

Chrome açık kalmalı; background enrich tarayıcıda çalışır.

---

## İki yol

| Yol | Ne zaman |
|-----|----------|
| **A — Kendi host (ürün)** | Prod: Contract’ı kendi backend’inde uygula, kendi DB, kendi Docker/K8s |
| **B — Referans demo** | Yerelde denemek: bu repodaki Compose |

### A) Kendi host (önerilen prod)

```text
1. HOST_CONTRACT + openapi.yaml → kendi API
2. DB şemanı sen tasarla (örnek: sql/schema.sql sadece referans)
3. extension/config.js → prodApiBase
4. Token üret → kullanıcı Connect
5. Extension zip / store dağıt
```

### B) Referans demo (yerel 5 dk)

```bash
cp .env.example .env
# ADMIN_KEY değiştir
docker compose up --build -d
./scripts/bootstrap-token.sh
```

- API: http://localhost:8088/v1/health  
- Örnek DB: localhost:5433  

Sonra:

1. `node scripts/apply-config.mjs`
2. Chrome → `chrome://extensions` → **Load unpacked** → `extension/`
3. Token + API URL → Connect

Operatör notları: [docs/OPERATOR.md](docs/OPERATOR.md)

---

## Extension kullanım (kullanıcı yüzü)

| Yol | Ne yapar |
|-----|----------|
| Find new leads / Search | Sonuç listesi → kaydet → background enrich |
| Import connections | Connections kaydır → aynı kuyruk |
| Connections.csv | Data export CSV (enrich’siz, daha güvenli) |
| Saved leads | Kayıtlı liste + Waiting / Queued / In progress / Done |

---

## White-label

1. `extension/config.js` (`brandName`, `prodApiBase`, `tokenPrefix`, enrich limitleri)
2. İkonlar (`extension/icons/`)
3. `node scripts/apply-config.mjs`

---

## Test / paket

```bash
npm test
npm run package   # dist/linkedin-import-extension-*.zip
```

---

## Notlar

- Kit DB tutmaz / dayatmaz — **BYO database**.
- Docker = backend dağıtımı; extension ayrı.
- LinkedIn ToS / hesap riski operatörün sorumluluğunda (ban-safe limitler varsayılan).
- AI host’ta; eklenti yalnızca `ai_status` gösterir.
- Changelog: [CHANGELOG.md](CHANGELOG.md) · License: [LICENSE](LICENSE) (proprietary).
