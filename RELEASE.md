# Yayın kontrol listesi — Dgmos Lead Capture

## Dgmos tarafı (bir kez)

- [ ] `backend/migrations/20261103_lead_capture_integration.sql` canlıda uygulandı
- [ ] `backend/migrations/20261103_lead_management_permissions.sql` canlıda uygulandı
- [ ] Eklentiyi kullanacak rollere `perm.lead-capture` (ve lead ekranları için `perm.lead-*`) atandı
- [ ] Backend deploy edildi; `POST <API>/modules/lead-capture-session` anahtarsız `401` dönüyor

## Her sürümde

1. Sürümü üç yerde aynı yap: `package.json`, `extension/package.json`, `extension/manifest.json`
   (paketleme betiği uyuşmazlıkta durur). `CHANGELOG.md`'ye not ekle.
2. Gerekirse `extension/config.js` → `prodApiBase` (production API adresi), sonra:
   ```bash
   npm --prefix extension ci
   npm test
   ```
3. Canlı sözleşme testi (test tenant'ı, `smoke-` önekli lead yazar):
   ```bash
   DGMOS_API=https://sandbox.dgmos.com/api DGMOS_KEY=dg_ak_pub_... npm run smoke
   ```
4. Paket: `npm run package` → `dist/dgmos-lead-capture-extension-<sürüm>.zip`
   (testler, LinkedIn fixture'ları ve npm dosyaları otomatik dışlanır).
5. Elle duman testi (Chrome → Load unpacked → `extension/`):
   - Public access key ile bağlan → başlıkta şirket adı
   - LinkedIn arama sayfası → tara → Import → `X new · 0 failed`
   - Aynı sayfa tekrar → `0 new`
   - Dgmos Aday Yönetimi'nde kayıt: Kaynak LinkedIn, Aşama Yeni Aday
   - `perm.lead-capture` olmayan key → anlaşılır izin hatası

## Dağıtım

- **Ekip içi:** zip'i paylaş; kullanıcı `chrome://extensions` → Geliştirici modu → zip'i aç → Load unpacked.
- **Chrome Web Store:** zip'i yükle; gizlilik politikası olarak `PRIVACY.md` (hukuk onayı sonrası) bir web
  adresinde yayınlanmalı; izin gerekçeleri `PRIVACY.md` → "İzinlerin amacı" bölümünden kopyalanabilir.
  Tek amaç: "Kullanıcının açtığı LinkedIn sayfalarındaki profilleri Dgmos CRM'e aday olarak kaydetmek."

## Bilinen sınırlar

- Arayüz İngilizce.
- LinkedIn otomasyonu LinkedIn kullanım şartlarıyla çelişebilir; eklenti yavaşlatma uygular
  (profil arası ~5,5 sn, oturum başı 40, günlük 120 detay ziyareti) ama hesap kısıtlaması riski sıfır değildir.
- AI lead analizi yok (planlandı: backend `pkg/ai` ile skor/sıcaklık).
