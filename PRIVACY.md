# Dgmos Lead Capture — Gizlilik Politikası / Privacy Policy

> TASLAK — yayından önce Dgmos hukuk / KVKK sorumlusu tarafından gözden geçirilmelidir.
> DRAFT — to be reviewed by Dgmos legal / data-protection officer before publishing.

## Türkçe

**Ne toplanır?** Kullanıcı eklentide taramayı veya içe aktarmayı **kendisi başlattığında**, açık olan LinkedIn
sayfasında kullanıcının zaten görebildiği bilgiler okunur: ad soyad, unvan/headline, şirket, konum, profil
adresi, "Hakkında" metni ve sayfada görünüyorsa e-posta, telefon ve web sitesi. Eklenti arka planda kendiliğinden
LinkedIn verisi toplamaz.

**Nereye gönderilir?** Yalnızca kullanıcının bağladığı **Dgmos hesabına** (Dgmos CRM — Aday Yönetimi).
Üçüncü taraflara, reklam veya analitik servislerine veri gönderilmez; eklentide izleme kodu yoktur.

**Tarayıcıda ne saklanır?**
- Dgmos erişim anahtarı ve API adresi: yalnızca bu cihazın tarayıcı deposunda (`chrome.storage.local`),
  başka cihazlarla senkronize edilmez. "Logout" ile silinir.
- Tarama ilerlemesi ve kuyruk durumu: geçici olarak yerel depoda.
- Arayüz tercihleri (seçili kaynak, panel görüldü bilgisi): Chrome senkron deposunda.

**Saklama ve silme:** Dgmos'a aktarılan kayıtlar, ilgili şirketin Dgmos hesabında o şirketin veri saklama
politikasına göre tutulur ve Dgmos Aday Yönetimi ekranından silinebilir. Eklentiyi kaldırmak tarayıcıdaki
tüm yerel verileri siler.

**İzinlerin amacı:**
- `activeTab`, `scripting`, `tabs`: kullanıcının açtığı LinkedIn sekmesini okumak ve profil detaylarını
  sırayla ziyaret etmek.
- `storage`: erişim anahtarı ve tarama durumunu saklamak.
- `alarms`: profil detaylarını LinkedIn'i yormadan, aralıklı işlemek.
- `sidePanel`: eklenti arayüzü.
- Ana bilgisayar izinleri: `linkedin.com` (veri okuma) ve Dgmos API adresi (veri gönderme).

**İletişim:** https://dgmos.com

## English

**What is collected?** Only when the user **starts** a scan or import, the extension reads information the user
can already see on the open LinkedIn page: name, title/headline, company, location, profile URL, "About" text
and, when visible on the page, email, phone and website. The extension does not collect LinkedIn data in the
background on its own.

**Where is it sent?** Only to the **Dgmos account** the user connects (Dgmos CRM — Lead Management). No data is
sent to third parties, advertising or analytics services; the extension contains no tracking code.

**What is stored in the browser?**
- Dgmos access key and API URL: in this device's browser storage only (`chrome.storage.local`), never synced
  to other devices. Removed on "Logout".
- Scan progress and queue state: temporarily in local storage.
- UI preferences (selected source, panel seen flag): in Chrome sync storage.

**Retention and deletion:** Records sent to Dgmos are kept in the company's Dgmos account under that company's
retention policy and can be deleted from Dgmos Lead Management. Uninstalling the extension removes all local data.

**Why each permission:**
- `activeTab`, `scripting`, `tabs`: read the LinkedIn tab the user opened and visit profile details one by one.
- `storage`: keep the access key and scan state.
- `alarms`: process profile details gradually so LinkedIn is not overloaded.
- `sidePanel`: the extension UI.
- Host permissions: `linkedin.com` (read) and the Dgmos API URL (send).

**Contact:** https://dgmos.com
