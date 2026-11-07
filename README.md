# Dgmos Lead Capture

5 dakikada dene: [QUICKSTART.md](QUICKSTART.md)

Chrome eklentisi LinkedIn profillerini toplar ve **doğrudan Dgmos backend'e** (Lead Management → `leads`) yazar.
Ayrı sunucu, Docker image veya veritabanı yoktur.

```
Eklenti (Side Panel)  --Bearer dg_ak_pub_…-->  Dgmos API /api/modules/*  -->  leads
```

## Dgmos'a nasıl düşer?

| Eklenti alanı | Dgmos `leads` | Kural |
|---|---|---|
| `profile_url` | `profile_url` | Normalize edilir (`/in/<slug>`, küçük harf, query/alt sayfa atılır). Tenant içinde **tekil**. |
| `name` | `contact_name` | Şirket sayfasında (`/company/…`) boş kalır. |
| `company` | `company_name` | Şirket yoksa kişi adı yazılır; şirket sonra gelirse güncellenir. |
| `title` / `headline` | `contact_title` | 100 karaktere kısaltılır. |
| `headline`, `about`, `location` | aynı adlı kolonlar | Her taramada güncellenir. |
| `email`, `phone`, `website` | aynı adlı kolonlar | **Yalnızca boşsa** doldurulur. |
| — | `source_id` | LinkedIn kaynağı |
| — | `stage_id`, `temperature` | Yeni Aday, COLD (yalnızca ilk kayıtta) |
| — | `assigned_user_id` | Access key'in sahibi (yalnızca ilk kayıtta) |
| `enrich_status` | `enrich_status` | `LISTED` → `ENRICHED`; geri düşmez. |

Satış ekibinin alanları (aşama, sorumlu, skor, tahmini değer, notlar) eklenti tarafından **asla ezilmez**.
Yeni kayıtta `CAPTURED`, zenginleştirmede `ENRICHED` aktivitesi yazılır. Silinmiş bir lead tekrar yakalanırsa geri alınır.

## Backend gereksinimleri

`backend` reposunda:

1. Migration: `migrations/20261103_lead_capture_integration.sql`
   — mevcut lead tablolarına yalnızca ekleme yapar (tablo oluşturmaz, mevcut veriye dokunmaz), tekrar çalıştırılabilir
2. Endpoint'ler:
   - `POST /api/modules/lead-capture-session` — bağlantı doğrulama
   - `POST /api/modules/lead-capture` — toplu upsert (en fazla 100)
   - `POST /api/modules/lead-capture-list` — liste, sayaçlar, cursor

## Access key

Dgmos → Servisler → API Anahtarları:

- Tip: **public** (`dg_ak_pub_…`). Secret key'ler istek imzası (HMAC) ister; eklentide kullanılmaz.
- Modül rota yetkileri: **Lead Management** (route `/api/modules/lead-capture*`, üç endpoint'i kapsar).
- İzin verilen IP adresleri (public key için zorunlu): Web Store kurulumu için
  `chrome-extension://bdocdakjpdgbdbajcifckjjcclgonegc`, Load unpacked için `chrome-extension://negmocgmhmehlmileahffipfdlnjppol`
- Key, oluşturan kullanıcı + şirket adına yazar; o kullanıcının rolünde `perm.lead-capture` olmalı.

### Sabit eklenti ID'si

`extension/manifest.json` içindeki `key` alanı eklenti ID'sini her kurulumda
`negmocgmhmehlmileahffipfdlnjppol` yapar; bu yüzden tek bir access key tüm ekipte çalışır.
`key` alanını değiştirmeyin/silmeyin — ID değişir ve tüm key'lerin origin'i güncellenmelidir.
Eşleşen private key `.keys/extension-signing-key.pem` (git'e girmez) yalnızca `.crx` imzalamak için gerekir;
"Load unpacked" ve zip dağıtımında kullanılmaz. Chrome Web Store'a yüklenirse mağazanın verdiği ID'yi
access key'e ikinci origin olarak ekleyin.

## Eklenti

```bash
# extension/config.js → prodApiBase, brandName
node scripts/apply-config.mjs
# chrome://extensions → Load unpacked → extension/
npm run package
```

Search / connections / CSV → kaydet → arka plan enrich → Saved leads.

## Test

Birim (eklenti; LinkedIn fixture'ları → API payload):

```bash
npm --prefix extension ci
npm test
```

Canlı sözleşme testi (sandbox tenant'ına `smoke-` önekli test lead'leri yazar):

```bash
DGMOS_API=https://sandbox.dgmos.com/api DGMOS_KEY=dg_ak_pub_... npm run smoke
```

## Yayın ve gizlilik

- Yayın adımları: [RELEASE.md](RELEASE.md)
- Gizlilik politikası (taslak): [PRIVACY.md](PRIVACY.md)
