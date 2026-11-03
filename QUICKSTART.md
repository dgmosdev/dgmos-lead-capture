# Quickstart — Dgmos Lead Capture

Eklenti LinkedIn'den toplar, doğrudan Dgmos'a yazar.

```
Chrome eklentisi  →  https://sandbox.dgmos.com/api  →  Dgmos leads
```

## 1. Access key

Dgmos → Servisler → **API Anahtarları** → Yeni anahtar:

- Tip: **Public** (Secret key eklentide çalışmaz: istek imzası ister)
- Route'lar: **Lead Capture (Chrome Eklentisi)** altındaki üçü
- İzinli alan adı (Allowed Origins): `chrome-extension://negmocgmhmehlmileahffipfdlnjppol`
  (eklenti ID'si `manifest.json` → `key` ile sabit; her bilgisayarda aynı)
- Anahtarı oluşturan kullanıcının rolünde `perm.lead-capture` olmalı.
- Oluşan `dg_ak_pub_…` değerini kopyala.

## 2. Eklentiyi yükle

1. `node scripts/apply-config.mjs`
2. Chrome → `chrome://extensions` → Geliştirici modu → **Load unpacked** → `extension/`
3. Eklenti ikonuna tıkla → Side Panel açılır.
4. Access key'i yapıştır → **Connect**.
   (Farklı ortam için: Advanced settings → API URL, ör. `http://localhost:<port>/api`)

## 3. Lead topla

LinkedIn'de bir arama, bağlantılar veya şirket sayfası aç → Side Panel → tara → **Import**.

Sonuç: `X new · Y updated · Z skipped` (hata varsa `failed` ve nedeni gösterilir).
Kayıtlar Dgmos → Lead Management'ta **Kaynak: LinkedIn**, **Aşama: Yeni Aday** olarak görünür;
eklentide **Saved leads** sayfasından da izlenir.

## Sorun giderme

| Belirti | Ne bak |
|---|---|
| "Access key is invalid…" | Key aktif mi, tipi public mi, üç Lead Capture route'u izinli mi |
| "Could not reach the API" | API URL `/api` ile bitiyor mu; domain `manifest.json` `host_permissions` içinde mi |
| `failed` > 0 | Backend migration `20261103_lead_capture_integration.sql` uygulandı mı |
