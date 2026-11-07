# Chrome Web Store başvurusu — kopyala/yapıştır

Paket: `npm run package:store` → `dist/dgmos-lead-capture-extension-<sürüm>-store.zip`
(manifest `key` alanı ve `localhost` izinleri bu pakette yok; mağaza kendi ID'sini verir.)

Görseller bu klasörde: `icon-128.png`, `screenshot-1280x800.png`, `promo-tile-440x280.png`.

---

## Store listing (Mağaza girişi)

**Name** (manifest'ten gelir): Dgmos Lead Capture

**Summary** (en fazla 132 karakter — bu 130):

```
Save LinkedIn profiles to your Dgmos CRM as leads: search results or connections, no duplicates, details filled in the background.
```

**Description:**

```
Dgmos Lead Capture saves people and companies you find on LinkedIn straight into Dgmos CRM (Lead Management) as leads.

How it works
• Open a LinkedIn search, your connections list or a company page and start a scan from the side panel.
• Every profile is saved to Dgmos once — re-importing updates the same lead instead of creating a duplicate.
• Details (headline, about, company, and contact info LinkedIn shows you) are filled in slowly in the background, a few profiles at a time, so your LinkedIn account is not overloaded.
• Your sales team's work in Dgmos — stage, owner, score, notes — is never overwritten.

Requirements
• A Dgmos account with the "Lead Capture" permission.
• A Dgmos Public access key (Dgmos → Services → API Keys) with the "Lead Management" module route permission and this extension's address in its allowed IP addresses. The connect screen shows the steps.

Privacy
The extension only reads LinkedIn pages you open and scan, and sends the data only to your own Dgmos account. No ads, no analytics, no third parties.
```

**Category:** Workflow & Planning (yoksa: Productivity)

**Language:** English

---

## Privacy practices (Gizlilik sekmesi)

**Single purpose description:**

```
Save profiles from LinkedIn pages the user opens into the user's own Dgmos CRM as leads.
```

**Permission justifications:**

| İzin | Gerekçe (yapıştır) |
|---|---|
| `activeTab` | `Reads the LinkedIn tab the user is on when they start a scan from the side panel.` |
| `scripting` | `Injects the collector into the user's LinkedIn tab to read profile names, titles and links from search results, connections and profile pages.` |
| `tabs` | `Finds or opens a LinkedIn tab and moves it between profile pages for the background detail visits, and reads the active tab URL to pick the right scan mode.` |
| `storage` | `Keeps the user's Dgmos access key on this device, scan progress and the detail-visit queue state.` |
| `alarms` | `Schedules the slow, rate-limited background detail visits (a few profiles every couple of minutes) so LinkedIn is not overloaded.` |
| `sidePanel` | `The extension's user interface is a Chrome side panel.` |
| Host `linkedin.com` | `Reads LinkedIn pages the user opens to collect profile data.` |
| Host `sandbox.dgmos.com` | `Sends the collected leads to the user's Dgmos account (Dgmos backend API).` |

**Are you using remote code?** No, I am not using remote code.

**Data usage — collected data (işaretle):**
- [x] Personally identifiable information (names, email addresses / phone numbers when LinkedIn shows them)
- [x] Authentication information (the user's Dgmos access key, stored locally)
- [x] Website content (LinkedIn profile text: title, about, company)
- Diğerleri: işaretleme.

**Certifications (üçünü de işaretle):**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `PRIVACY.md`'nin hukuk onayından sonra dgmos.com'da yayınlandığı adres
(ör. `https://dgmos.com/legal/lead-capture-privacy`). Bu alan zorunlu.

---

## Distribution (Dağıtım)

- **Visibility:** `Unlisted` önerilir (yalnızca linki olan kurar; aramada çıkmaz).
  Herkese açık (`Public`) LinkedIn otomasyonu nedeniyle daha sıkı incelenir.
  dgmos.com bir Google Workspace alanıysa `Private` (yalnızca alan kullanıcıları) da seçilebilir.
- **Regions:** All regions (ya da yalnızca Türkiye).

---

## Onaydan sonra

1. Mağazanın verdiği **item ID**'yi al (Dashboard → öğe → URL'deki 32 harf).
2. Dgmos'taki eklenti access key'lerine ikinci Allowed Origin ekle: `chrome-extension://<item-id>`
   (ya da yeni key oluştur). Eklentinin bağlantı ekranı kendi origin'ini zaten gösteriyor.
3. Ekibe mağaza linkini gönder; eski "Load unpacked" kurulumunu kaldırsınlar.
4. Güncelleme: üç yerde sürümü artır (`package.json`, `extension/package.json`, `extension/manifest.json`),
   `npm run package:store`, Dashboard → Package → **Upload new package** → Submit for review.
