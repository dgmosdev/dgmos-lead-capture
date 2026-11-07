# Quickstart — Dgmos Lead Capture

Eklenti LinkedIn'den toplar, doğrudan Dgmos'a yazar.

```
Chrome eklentisi  →  https://sandbox.dgmos.com/api  →  Dgmos leads
```

## 1. Access key

[Dgmos → Servisler → API Anahtarları](https://go.dgmos.com/apps/services/api-keys) → **Yeni API anahtarı oluştur**:

- Anahtar türü: **Genel anahtar** (Public; Secret key eklentide çalışmaz: istek imzası ister)
- Modül rota yetkileri: **Lead Management** işaretle → **İleri**
- İzin verilen IP adresleri: eklentinin adresi
  - Chrome Web Store kurulumu: `chrome-extension://bdocdakjpdgbdbajcifckjjcclgonegc`
  - Load unpacked / ekip zip'i: `chrome-extension://negmocgmhmehlmileahffipfdlnjppol`
    (ID `manifest.json` → `key` ile sabit; her bilgisayarda aynı)
  - Eklentinin bağlantı ekranı kendi adresini gösterir ve **Copy** ile kopyalatır.
- Anahtarı oluşturan kullanıcının rolünde `perm.lead-capture` olmalı.
- Oluşan **Access key** (`dg_ak_pub_…`) değerini kopyala.

## 2. Eklentiyi yükle

1. `node scripts/apply-config.mjs`
2. Chrome → `chrome://extensions` → Geliştirici modu → **Load unpacked** → `extension/`
3. Eklenti ikonuna tıkla → Side Panel açılır.
4. Access key'i yapıştır → **Connect**.

## 3. Lead topla

LinkedIn'de bir arama, bağlantılar veya şirket sayfası aç → Side Panel → tara → **Import**.

Sonuç: `X new · Y updated · Z skipped` (hata varsa `failed` ve nedeni gösterilir).
Kayıtlar Dgmos → Lead Management'ta **Kaynak: LinkedIn**, **Aşama: Yeni Aday** olarak görünür;
eklentide **Saved leads** sayfasından da izlenir.

## Sorun giderme

| Belirti | Ne bak |
|---|---|
| "Dgmos rejected the access key (401)" | Key aktif mi, tipi Public mi, izin verilen IP adreslerinde eklenti adresi var mı, Lead Management yetkisi seçili mi. `20261104_lead_capture_permission_url.sql` öncesi oluşturulan key'leri yeniden oluşturun |
| "Could not reach the API" | `extension/config.js` → `defaultApiBase` `/api` ile bitiyor mu; domain `manifest.json` `host_permissions` içinde mi |
| `failed` > 0 | Backend migration `20261103_lead_capture_integration.sql` uygulandı mı |
