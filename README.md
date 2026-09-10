# LinkedIn Import Kit

Bağımsız paket: LinkedIn’den lead çek → **Host API**’ye kaydet (upsert).

**Kapsam:** çek + kaydet. Varsayılan: önce listeyi bitir, sonra profilleri sırayla enrich et. AI score / outreach / upstream SaaS **yok**.

**DB bu kit’in parçası değil.** Host kendi veritabanını bağlar (Postgres, MySQL, …). Kit’in sözleşmesi yalnızca HTTP Host Contract.

```
LinkedIn (tarayıcı)
  → Chrome Extension (white-label)
    → Host API (/v1/*)     ← ürün yüzeyi
         → Host’un kendi DB’si (BYO)
```

Opsiyonel: repodaki Go API + Compose Postgres yalnızca **referans demo** (hızlı deneme).

Varsayılan marka: **Dgmos** (`extension/config.js`).

## İki yol

| Yol | Ne zaman |
|-----|----------|
| **A — Kendi host** | Prod / X·Y·Z projeleri: Contract’ı kendi backend’inde uygula, kendi DB’ni bağla |
| **B — Referans demo** | Yerelde denemek: `docker compose` (API + örnek Postgres) |

### A) Kendi host (önerilen)

1. [docs/HOST_CONTRACT.md](docs/HOST_CONTRACT.md) + [docs/openapi.yaml](docs/openapi.yaml)
2. Extension: `config.js` → `prodApiBase` = senin API
3. Token’ı kendi auth’unla üret → Connect

Detay: [docs/INTEGRATION.md](docs/INTEGRATION.md)

### B) Referans demo (5 dk)

```bash
cp .env.example .env
# ADMIN_KEY değerini değiştir
docker compose up --build -d
./scripts/bootstrap-token.sh
```

API: http://localhost:8088/v1/health  
Örnek DB: localhost:5433 (yalnızca demo)

### Extension yükle

1. `node scripts/apply-config.mjs`
2. Chrome → `chrome://extensions` → **Load unpacked** → `extension/`
3. Token + API URL → Connect

### Kullanım

| Yol | Ne yapar |
|-----|----------|
| Connections | Listeyi kaydırır → sonra sırayla profil enrich |
| Search / Sales Nav / People | Sonuç listesi → enrich |
| Connections.csv | Data export CSV (enrich’siz güvenli yol) |

## White-label

1. `extension/config.js`
2. İkonlar
3. `node scripts/apply-config.mjs`

## Host Contract (özet)

Eklenti sadece `apiBase` + Bearer kullanır. DB şeması / motoru **host’a aittir**.

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` | — |
| GET | `/v1/session` | Bearer |
| POST | `/v1/leads` | Bearer (max 100/batch) |

Token admin endpoint’leri referans API’de vardır; kendi host’unda kendi auth’unu kullanabilirsin.

## Test / paket

```bash
npm test
npm run package   # dist/linkedin-import-extension-*.zip
```

## Notlar

- Kit DB tutmaz / dayatmaz — BYO database.
- LinkedIn ToS / hesap riski operatörün sorumluluğunda.
- Sürüm **1.1.0** — [CHANGELOG.md](CHANGELOG.md), [LICENSE](LICENSE) (proprietary).
