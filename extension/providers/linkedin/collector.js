(function registerLiImportCollector() {
  const SKIP_PROFILE_SLUGS = new Set([
    "me",
    "feed",
    "jobs",
    "pulse",
    "login",
    "signup",
    "learning",
    "sales",
    "messaging",
    "notifications",
    "company",
    "school",
    "groups",
    "events",
    "games",
    "search"
  ]);

  function normalizeLinkedInURL(href) {
    if (!href) return "";
    try {
      const url = new URL(href, "https://www.linkedin.com");
      if (!url.hostname.includes("linkedin.com")) return "";
      if (!url.pathname.includes("/in/") && !url.pathname.includes("/company/")) return "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function profileSlugFromPath(pathname) {
    const match = pathname.match(/^\/in\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function isProfilePage(pathname) {
    const slug = profileSlugFromPath(pathname).toLowerCase();
    if (!slug) return false;
    if (SKIP_PROFILE_SLUGS.has(slug)) return false;
    if (slug.startsWith("acw") || slug.startsWith("aec")) return false;
    return slug.length >= 2;
  }

  function isProfilePath(pathname) {
    return isProfilePage(pathname) && /^\/in\/[^/?#]+\/?$/i.test(pathname);
  }

  function profileUrlFromPath(pathname) {
    const slug = profileSlugFromPath(pathname);
    if (!slug || !isProfilePage(pathname)) return "";
    return normalizeLinkedInURL(`https://www.linkedin.com/in/${slug}`);
  }

  function isConnectionsPage(pathname) {
    return (
      pathname.includes("/mynetwork/invite-connect/connections") ||
      pathname.includes("/mynetwork/connections") ||
      /^\/connections\/?$/i.test(pathname)
    );
  }

  function isSearchPage(pathname) {
    const core = globalThis.LiImportLinkedInCore;
    if (core?.isSearchPath) return core.isSearchPath(pathname);
    return String(pathname || "").includes("/search/") || isCompanyPeoplePath(pathname);
  }

  function isCompanyPeoplePath(pathname) {
    const core = globalThis.LiImportLinkedInCore;
    if (core?.isCompanyPeoplePath) return core.isCompanyPeoplePath(pathname);
    return /^\/company\/[^/?#]+\/people\/?/i.test(String(pathname || ""));
  }

  function isCompanyPath(pathname) {
    return /^\/company\/[^/?#]+\/?$/i.test(pathname);
  }

  function detectPageGate() {
    const core = globalThis.LiImportLinkedInCore;
    if (core?.detectPageGate) return core.detectPageGate(document, location.href);
    return { ok: true, error: "" };
  }

  function companySlugFromPath(pathname) {
    const match = String(pathname || "").match(/^\/company\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function isImportableEntityPath(pathname) {
    return isProfilePath(pathname) || isCompanyPath(pathname);
  }

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function metaContent(selector) {
    return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
  }

  function isContactOverlayPage(pathname) {
    if (/\/overlay\/contact-info/i.test(String(pathname || ""))) return true;
    return Boolean(
      document.querySelector(
        '[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay"]'
      ) || document.querySelector('dialog [data-testid="dialog-content"] h2')
    );
  }

  function decodeLinkedInSafetyUrl(href) {
    try {
      const url = new URL(String(href || ""), location.href);
      if (!url.hostname.includes("linkedin.com") || !url.pathname.includes("/safety/go")) {
        return String(href || "").trim();
      }
      const target = url.searchParams.get("url");
      return target ? decodeURIComponent(target) : String(href || "").trim();
    } catch {
      return String(href || "").trim();
    }
  }

  const CONTACT_LABEL_PATTERNS = {
    email: /^(e-?posta|e-?mail|email)$/i,
    phone: /^(telefon|phone|mobile|cep|cell)$/i,
    website: /^(web\s*sitesi|website|site|url)$/i
  };

  const CONTACT_ICON_FIELDS = {
    "envelope-medium": "email",
    "envelope-small": "email",
    "phone-handset-medium": "phone",
    "phone-handset-small": "phone",
    "link-medium": "website",
    "link-small": "website"
  };

  function profileSlugFromUrl(url) {
    const match = String(url || "").match(/\/in\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function contactOverlayUrl(profileUrl) {
    const slug = profileSlugFromUrl(profileUrl);
    return slug ? `https://www.linkedin.com/in/${slug}/overlay/contact-info/` : "";
  }

  function normalizeEmail(raw) {
    const value = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^mailto:/i, "")
      .split("?")[0];
    if (!value || !value.includes("@") || value.includes("linkedin.com")) return "";
    return value;
  }

  function normalizePhone(raw) {
    const value = String(raw || "")
      .trim()
      .replace(/^tel:/i, "")
      .replace(/\s*\((iş|kişisel|mobile|home|work|cep|ev|personal|business)\)\s*$/i, "")
      .trim();
    if (!value) return "";
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return "";
    if (digits.startsWith("90") && digits.length === 12) return `+${digits}`;
    if (digits.startsWith("0")) return digits;
    if (digits.startsWith("5") && digits.length === 10) return `0${digits}`;
    return digits;
  }

  function normalizeWebsite(raw) {
    let value = decodeLinkedInSafetyUrl(String(raw || "").trim()).replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!value || /linkedin\.com/i.test(value)) return "";
    if (!/^https?:\/\//i.test(value)) {
      value = `https://${value.replace(/^www\./i, "www.")}`;
    }
    try {
      const url = new URL(value);
      if (!url.hostname.includes(".")) return "";
      return url.origin;
    } catch {
      const domain = value.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
      if (domain && domain.includes(".") && !/linkedin\.com/i.test(domain)) {
        return normalizeWebsite(`https://${domain}`);
      }
      return "";
    }
  }

  function normalizeImageUrl(raw) {
    const value = String(raw || "").trim();
    if (!value || value.startsWith("data:")) return "";
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "https:") return "";
      if (!/(^|\.)linkedin\.com$|(^|\.)licdn\.com$/i.test(url.hostname)) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function websiteFromAnchor(anchor) {
    if (!anchor) return "";
    const href = decodeLinkedInSafetyUrl(anchor.getAttribute("href") || "");
    const linkText = text(anchor);
    return normalizeWebsite(href) || normalizeWebsite(linkText);
  }

  function contactValueFromLabelNode(labelEl) {
    if (!labelEl) return "";
    const parent = labelEl.parentElement;
    const paragraphs = parent ? Array.from(parent.querySelectorAll("p")) : [];
    const labelIndex = paragraphs.indexOf(labelEl);
    if (labelIndex >= 0 && paragraphs[labelIndex + 1]) {
      return text(paragraphs[labelIndex + 1]);
    }
    const sibling = labelEl.nextElementSibling;
    return sibling ? text(sibling) : "";
  }

  function applyContactLabel(label, value, state) {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    if (CONTACT_LABEL_PATTERNS.email.test(label) && !state.email) {
      state.email = normalizeEmail(cleaned) || normalizeEmail(cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || "");
    }
    if (CONTACT_LABEL_PATTERNS.phone.test(label) && !state.phone) {
      state.phone = extractPhoneFromText(cleaned);
    }
    if (CONTACT_LABEL_PATTERNS.website.test(label) && !state.website) {
      state.website = normalizeWebsite(cleaned);
    }
  }

  function extractContactFromSduiIcons(state) {
    document.querySelectorAll("svg[id]").forEach((svg) => {
      const field = CONTACT_ICON_FIELDS[svg.id];
      if (!field || state[field]) return;
      const block =
        svg.closest("[componentkey]") ||
        svg.closest("section, li, div") ||
        svg.parentElement;
      if (!block) return;

      const mailto = block.querySelector('a[href^="mailto:"]');
      const tel = block.querySelector('a[href^="tel:"]');
      const http = block.querySelector('a[href^="http"]');

      if (field === "email" && mailto) {
        state.email = normalizeEmail(mailto.getAttribute("href") || text(mailto));
      } else if (field === "phone") {
        state.phone = extractPhoneFromText(
          tel?.getAttribute("href") || text(tel) || text(block.querySelector("a, span, p:last-child")) || text(block)
        );
      } else if (field === "website") {
        state.website = websiteFromAnchor(http) || normalizeWebsite(text(block));
      }
    });
  }

  function extractContactFromLabelParagraphs(state) {
    const roots = [
      document.querySelector(
        '[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay"]'
      ),
      document.querySelector(".pv-contact-info"),
      document.querySelector('dialog [data-testid="dialog-content"]'),
      document.querySelector("main")
    ].filter(Boolean);

    const seen = new Set();
    roots.forEach((root) => {
      root.querySelectorAll("p").forEach((labelEl) => {
        if (seen.has(labelEl)) return;
        const label = text(labelEl);
        if (!label) return;
        const field = Object.entries(CONTACT_LABEL_PATTERNS).find(([, pattern]) => pattern.test(label))?.[0];
        if (!field || state[field]) return;
        seen.add(labelEl);
        const value = contactValueFromLabelNode(labelEl);
        applyContactLabel(label, value, state);
      });
    });
  }

  function extractPhoneFromText(raw) {
    const text = String(raw || "").trim();
    const trMatch = text.match(/(?:\+90[\s.-]*)?0\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/);
    if (trMatch) return normalizePhone(trMatch[0]);
    const intlMatch = text.match(/\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,9}/);
    if (intlMatch) return normalizePhone(intlMatch[0]);
    return normalizePhone(text);
  }

  function extractContactFields() {
    const state = { email: "", phone: "", website: "" };
    const root =
      document.querySelector(
        '[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay"]'
      ) ||
      document.querySelector('dialog [data-testid="dialog-content"]') ||
      document.querySelector(".pv-contact-info") ||
      document.querySelector("main") ||
      document.body;

    for (const anchor of root.querySelectorAll('a[href^="mailto:"]')) {
      const candidate = normalizeEmail(anchor.getAttribute("href") || anchor.textContent);
      if (candidate) {
        state.email = candidate;
        break;
      }
    }

    for (const anchor of root.querySelectorAll('a[href^="tel:"]')) {
      const candidate = normalizePhone(anchor.getAttribute("href") || anchor.textContent);
      if (candidate) {
        state.phone = candidate;
        break;
      }
    }

    for (const anchor of root.querySelectorAll('a[href^="http"]')) {
      const candidate = websiteFromAnchor(anchor);
      if (candidate) {
        state.website = candidate;
        break;
      }
    }

    extractContactFromSduiIcons(state);
    extractContactFromLabelParagraphs(state);

    const sectionSelectors = [
      ".pv-contact-info__contact-type",
      "section.pv-contact-info__contact-item",
      ".artdeco-modal .pv-contact-info__contact-type",
      ".pv-contact-info__ci-container",
      "[data-view-name='profile-contact-info'] li",
      "[data-view-name='contact-info'] li",
      "[componentkey*='ContactInfo'] > div > div > div > div",
      "main section",
      "main li.artdeco-list__item"
    ];
    const seen = new Set();
    sectionSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((section) => {
        if (seen.has(section)) return;
        seen.add(section);

        const header =
          text(section.querySelector("h3, .pv-contact-info__header, header")) ||
          text(section.querySelector(".t-16")) ||
          text(section.querySelector("p"));
        const link = section.querySelector("a[href]");
        const linkHref = link?.getAttribute("href") || "";
        const linkText = text(link) || text(section.querySelector("span")) || text(section);
        const headerLower = header.toLowerCase();
        const blockLower = text(section).toLowerCase();

        if (!state.email && (/email|e-posta|e-mail/i.test(headerLower) || blockLower.includes("e-posta"))) {
          state.email = normalizeEmail(linkHref || linkText);
          if (!state.email) {
            const match = text(section).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) state.email = normalizeEmail(match[0]);
          }
        }
        if (!state.phone && (/phone|telefon|mobile|cep/i.test(headerLower) || blockLower.includes("telefon"))) {
          state.phone = extractPhoneFromText(linkText || text(section));
        }
        if (!state.website && (/website|web sitesi/i.test(headerLower) || blockLower.includes("web sitesi"))) {
          state.website = websiteFromAnchor(section.querySelector("a[href^='http']")) || normalizeWebsite(linkText || text(section));
        }
      });
    });

    document
      .querySelectorAll(
        '[data-test-icon="envelope-medium"], [data-test-icon="phone-handset-medium"], [data-test-icon="link-medium"], svg#envelope-medium, svg#phone-handset-medium, svg#link-medium'
      )
      .forEach((icon) => {
        const section = icon.closest("section, li, .pv-contact-info__contact-type, .pv-contact-info__contact-item, [componentkey]");
        if (!section) return;
        const value = text(section.querySelector("a, span")) || text(section);
        if ((icon.matches('[data-test-icon="envelope-medium"]') || icon.id === "envelope-medium") && !state.email) {
          state.email = normalizeEmail(value);
        }
        if ((icon.matches('[data-test-icon="phone-handset-medium"]') || icon.id === "phone-handset-medium") && !state.phone) {
          state.phone = extractPhoneFromText(value);
        }
        if ((icon.matches('[data-test-icon="link-medium"]') || icon.id === "link-medium") && !state.website) {
          state.website = websiteFromAnchor(section.querySelector("a[href^='http']")) || normalizeWebsite(value);
        }
      });

    if (!state.email) {
      const match = root.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (match) state.email = normalizeEmail(match[0]);
    }
    if (!state.phone && isContactOverlayPage(location.pathname)) {
      const match = root.innerText.match(/(?:\+90[\s.-]*)?0\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/);
      if (match) state.phone = extractPhoneFromText(match[0]);
    }
    if (!state.website) {
      const match = root.innerText.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/[^\s)]*)?/i);
      if (match && !/linkedin\.com/i.test(match[0])) {
        state.website = normalizeWebsite(match[0]);
      }
    }

    return state;
  }

  async function openContactInfoModal() {
    const button =
      document.querySelector("#top-card-text-details-contact-info") ||
      document.querySelector('a[href*="/overlay/contact-info"]') ||
      Array.from(document.querySelectorAll("a, button")).find((el) =>
        /contact info|iletişim bilgileri/i.test(
          `${el.getAttribute("aria-label") || ""} ${text(el)}`
        )
      ) ||
      document.querySelector('button[aria-label*="Contact info"]') ||
      document.querySelector('button[aria-label*="İletişim"]');
    if (!button) return false;
    button.click();
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      if (
        document.querySelector(
          '[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay"]'
        ) ||
        document.querySelector('dialog [data-testid="dialog-content"]') ||
        document.querySelector(".pv-contact-info")
      ) {
        await sleep(250);
        return true;
      }
      await sleep(120);
    }
    await sleep(400);
    return false;
  }

  function nameFromDocumentTitle() {
    const raw = document.title || "";
    return raw.split("|")[0]?.split("- LinkedIn")[0]?.trim() || "";
  }

  function nameFromSlug(url) {
    const match = String(url).match(/\/in\/([^/?#]+)/i);
    if (!match) return "";
    const slug = decodeURIComponent(match[1]);
    if (!slug || /^\d+$/.test(slug) || slug.startsWith("ACo")) return "";
    // Yalnızca ad-soyad slug'ları (tireli); mcoskuncelebi gibi kullanıcı adlarını alma
    if (!slug.includes("-")) return "";
    return slug
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  function nameFromAriaLabel(label) {
    const raw = String(label || "").trim();
    if (!raw) return "";

    const viewPatterns = [
      /^View\s+(.+?)['’]s profile$/i,
      /^Open\s+(.+?)['’]s profile$/i,
      /^(.+?)\s+adlı kullanıcının profilini görüntüle$/i,
      /^(.+?)\s+profilini görüntüle$/i,
      /^(.+?)\s+profiline git$/i
    ];
    for (const pattern of viewPatterns) {
      const match = raw.match(pattern);
      if (match?.[1]) return cleanPersonName(match[1]);
    }

    if (!/^(view|open)\s+/i.test(raw) && !/profil/i.test(raw)) {
      return cleanPersonName(raw);
    }
    return "";
  }

  function stripMemberIdSuffix(name) {
    return String(name || "")
      .replace(/\s+[a-f0-9]{6,}[a-z0-9]*$/i, "")
      .replace(/\s+\d{5,}[a-z0-9]*$/i, "")
      .trim();
  }

  function slugFromUrl(url) {
    try {
      return profileSlugFromPath(new URL(url).pathname).toLowerCase().replace(/-/g, "");
    } catch {
      return "";
    }
  }

  function isLikelyUsernameSlug(name, url) {
    const cleaned = String(name || "").trim();
    if (!cleaned) return true;
    const compact = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
    const slug = slugFromUrl(url);
    if (slug && compact === slug.replace(/[^a-z0-9]/g, "")) return true;
    if (!/\s/.test(cleaned) && /^[a-z0-9]+$/i.test(compact) && compact.length <= 28) return true;
    return false;
  }

  function splitGluedNameHeadline(raw) {
    const value = String(raw || "").replace(/\s+/g, " ").trim();
    if (!value) return { name: "", headline: "" };

    // ŞanlıComputer, YapagciogluDriving …
    let match = value.match(/^(.+?[a-zçğıöşü])([A-ZÇĞİÖŞÜ][\s\S].+)$/);
    if (match && match[1].length >= 3 && match[2].length >= 4) {
      return { name: match[1].trim(), headline: match[2].trim() };
    }

    // YILDIZFull Stack …
    match = value.match(/^(.+?\s?[A-Z]{2,})([A-Z][a-z][\s\S]+)$/);
    if (match && match[1].length >= 3 && match[2].length >= 4) {
      return { name: match[1].trim(), headline: match[2].trim() };
    }

    return { name: value, headline: "" };
  }

  function resolveConnectionName(link, card, linkedin_url) {
    let headlineHint = "";

    function pickName(raw) {
      if (!raw) return "";
      const split = splitGluedNameHeadline(stripMemberIdSuffix(String(raw).trim()));
      if (split.headline && !headlineHint) headlineHint = split.headline;
      const name = cleanPersonName(split.name || raw);
      if (!name || isLikelyUsernameSlug(name, linkedin_url)) return "";
      return name;
    }

    const attempts = [
      () => pickName(text(card?.querySelector(".mn-connection-card__name"))),
      () => pickName(text(card?.querySelector("[data-anonymize='person-name']"))),
      () => pickName(nameFromAriaLabel(link?.getAttribute("aria-label"))),
      () => pickName(text(link?.querySelector(".visually-hidden"))),
      () => {
        const scope = card || link?.parentElement;
        const spans = scope?.querySelectorAll("span[aria-hidden='true']") || [];
        for (const span of spans) {
          const candidate = pickName(text(span));
          if (candidate && candidate.length <= 60) return candidate;
        }
        return "";
      },
      () => pickName(text(card?.querySelector(".artdeco-entity-lockup__title"))),
      () => pickName(text(link))
    ];

    for (const attempt of attempts) {
      const name = attempt();
      if (name) return { name, headlineHint };
    }

    const fromSlug = stripMemberIdSuffix(nameFromSlug(linkedin_url));
    if (fromSlug && !isLikelyUsernameSlug(fromSlug, linkedin_url)) {
      return { name: fromSlug, headlineHint: "" };
    }
    return { name: "", headlineHint: "" };
  }

  function resolveConnectionHeadline(card, name) {
    const direct =
      text(card.querySelector(".mn-connection-card__occupation")) ||
      text(card.querySelector(".artdeco-entity-lockup__subtitle")) ||
      text(card.querySelector("[data-field='occupation']")) ||
      text(card.querySelector("div[class*='occupation']")) ||
      text(card.querySelector("p[class*='headline']")) ||
      text(card.querySelector(".entity-result__primary-subtitle")) ||
      text(card.querySelector("[data-anonymize='headline']")) ||
      text(card.querySelector("span[class*='subtitle']")) ||
      text(card.querySelector(".connected-entity-list__meta")) ||
      text(card.querySelector(".entity-collection-item__meta"));

    if (direct) return direct;

    const lines = linesFromCard(card);
    const nameIndex = lines.findIndex((line) => {
      const cleaned = stripMemberIdSuffix(cleanPersonName(line));
      return cleaned && cleaned === name;
    });
    if (nameIndex >= 0 && lines[nameIndex + 1]) {
      const next = lines[nameIndex + 1];
      if (!/connected|bağlantı|message|mesaj/i.test(next)) return next;
    }
    if (lines.length >= 2) {
      const first = stripMemberIdSuffix(cleanPersonName(lines[0]));
      if (first === name && lines[1] && !/connected|bağlantı/i.test(lines[1])) return lines[1];
    }
    return "";
  }

  function cleanPersonName(value) {
    let name = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s*[|\-–].*$/, "")
      .replace(/View\s+.+'s profile/i, "")
      .replace(/profilini görüntüle/i, "")
      .trim();
    name = stripMemberIdSuffix(name);
    if (!name || name.length < 2 || name.length > 80) return "";
    if (/^(linkedin|profile|connect|message|follow)$/i.test(name)) return "";
    return name;
  }

  function splitHeadline(headline) {
    let title = headline;
    let company = "";
    if (!headline) return { title: "", company: "" };
    if (headline.includes(" at ")) {
      const parts = headline.split(" at ");
      title = parts[0]?.trim() || "";
      company = parts.slice(1).join(" at ").trim();
    } else if (headline.includes(" @ ")) {
      const parts = headline.split(" @ ");
      title = parts[0]?.trim() || "";
      company = parts.slice(1).join(" @ ").trim();
    } else if (headline.includes(" · ")) {
      const parts = headline.split(" · ");
      title = parts[0]?.trim() || "";
      company = parts[1]?.trim() || "";
    } else if (headline.includes(" | ")) {
      const parts = headline.split(" | ");
      title = parts[0]?.trim() || "";
      company = parts[1]?.trim() || "";
    } else if (headline.includes(",")) {
      const parts = headline.split(",");
      title = parts[0]?.trim() || "";
      company = parts.slice(1).join(",").trim();
    }
    return { title, company };
  }

  function normalizeLead(lead) {
    const linkedin_url = normalizeLinkedInURL(lead?.linkedin_url || lead?.profile_url || "");
    const avatar_url = normalizeImageUrl(lead?.avatar_url || lead?.profile_image_url || lead?.image_url || "");
    let rawName = String(lead?.name || "");
    let headline = String(lead?.headline || "").trim();

    if (!headline) {
      const split = splitGluedNameHeadline(rawName);
      if (split.headline) {
        rawName = split.name;
        headline = split.headline;
      }
    }

    const fromHeadline = splitHeadline(headline);
    let title = String(lead?.title || fromHeadline.title || "").trim();
    let company = String(lead?.company || fromHeadline.company || "").trim();
    if (!title && headline) title = headline.trim();

    let name = cleanPersonName(rawName);
    if (name && linkedin_url && isLikelyUsernameSlug(name, linkedin_url)) {
      name = "";
    }
    return {
      name,
      linkedin_url,
      profile_url: linkedin_url,
      avatar_url,
      profile_image_url: avatar_url,
      headline: headline || [title, company].filter(Boolean).join(" @ ") || "",
      title,
      company,
      location: String(lead?.location || "").trim(),
      email: String(lead?.email || "").trim().toLowerCase(),
      phone: String(lead?.phone || "").trim(),
      website: normalizeWebsite(String(lead?.website || "").trim()) || String(lead?.website || "").trim(),
      about: String(lead?.about || "").trim(),
      connected_at: String(lead?.connected_at || "").trim()
    };
  }

  function mergeLead(base, patch) {
    const left = normalizeLead(base || {});
    const right = normalizeLead(patch || {});
    return normalizeLead({
      name: right.name || left.name,
      linkedin_url: left.linkedin_url || right.linkedin_url,
      headline: right.headline || left.headline,
      title: right.title || left.title,
      company: right.company || left.company,
      location: right.location || left.location,
      avatar_url: right.avatar_url || left.avatar_url,
      profile_image_url: right.profile_image_url || left.profile_image_url,
      email: right.email || left.email,
      phone: right.phone || left.phone,
      website: right.website || left.website,
      about: right.about || left.about,
      connected_at: right.connected_at || left.connected_at
    });
  }

  function leadNeedsEnrich(lead) {
    const normalized = normalizeLead(lead);
    if (!normalized.linkedin_url) return false;
    return true;
  }

  function linesFromCard(card) {
    return String(card?.innerText || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !/^(Message|Mesaj|Bağlantı|Connected on|Connected|Bağlantı tarihi)$/i.test(line));
  }

  function parseConnectionCard(card) {
    const link =
      card.querySelector("a.mn-connection-card__link[href*='/in/']") ||
      card.querySelector("a[href*='/in/'][data-field='connection_name']") ||
      card.querySelector("a[href*='/in/'][aria-label]") ||
      card.querySelector("a[href*='/in/']:not([href*='/company/'])");
    const linkedin_url = normalizeLinkedInURL(link?.getAttribute("href"));
    if (!linkedin_url) return null;

    const { name, headlineHint } = resolveConnectionName(link, card, linkedin_url);
    if (!name) return null;

    const inferredHeadline = resolveConnectionHeadline(card, name) || headlineHint;
    const location =
      text(card.querySelector(".mn-connection-card__location")) ||
      text(card.querySelector(".entity-result__secondary-subtitle")) ||
      text(card.querySelector("[data-field='location']"));

    const connected_at =
      text(card.querySelector("time")) ||
      text(card.querySelector(".mn-connection-card__time-badge")) ||
      text(card.querySelector("span[class*='time-badge']"));

    const { title, company } = splitHeadline(inferredHeadline);
    const avatar =
      card.querySelector("img.mn-connection-card__picture") ||
      card.querySelector("img.presence-entity__image") ||
      card.querySelector("img.ivm-view-attr__img--centered") ||
      card.querySelector("img.ivm-view-attr__img") ||
      card.querySelector("img.EntityPhoto-circle-3") ||
      card.querySelector("img[alt]");
    const avatar_url = normalizeImageUrl(
      avatar?.currentSrc ||
        avatar?.getAttribute("src") ||
        avatar?.getAttribute("data-delayed-url") ||
        avatar?.getAttribute("data-ghost-url")
    );

    return normalizeLead({
      name,
      linkedin_url,
      avatar_url,
      headline: inferredHeadline,
      title,
      company,
      location,
      connected_at
    });
  }

  function parseProfileAbout() {
    const selectors = [
      "section[data-view-name='profile-about'] .inline-show-more-text span[aria-hidden='true']",
      "section[data-view-name='profile-about'] .display-flex.full-width span[aria-hidden='true']",
      "#about ~ .display-flex .inline-show-more-text span[aria-hidden='true']",
      ".pv-about__summary-text",
      "[data-anonymize='about-section']",
      "section.artdeco-card:has(#about) .inline-show-more-text span[aria-hidden='true']"
    ];
    for (const selector of selectors) {
      const value = text(document.querySelector(selector));
      if (value.length >= 12) return value.slice(0, 2000);
    }
    const aboutSection =
      document.querySelector("section[data-view-name='profile-about']") ||
      document.querySelector("#about")?.closest("section");
    if (aboutSection) {
      const value = text(
        aboutSection.querySelector(".inline-show-more-text, .pv-shared-text-with-see-more, span[aria-hidden='true']")
      );
      if (value.length >= 12) return value.slice(0, 2000);
    }
    return "";
  }

  function parseCurrentExperience() {
    const section =
      document.querySelector("[data-view-name='profile-experience']") ||
      document.querySelector("#experience")?.closest("section");
    if (!section) return { title: "", company: "" };

    const firstItem = section.querySelector("li.artdeco-list__item, .pvs-list__paged-list-item, .pvs-entity");
    if (!firstItem) return { title: "", company: "" };

    const title =
      text(firstItem.querySelector(".mr1.hoverable-link-text span[aria-hidden='true']")) ||
      text(firstItem.querySelector("[data-field='experience_title']")) ||
      text(firstItem.querySelector(".t-bold span[aria-hidden='true']"));

    const company =
      text(firstItem.querySelector(".t-14.t-normal span[aria-hidden='true']")) ||
      text(firstItem.querySelector("[data-field='experience_company']")) ||
      text(firstItem.querySelector(".t-14.t-normal:not(.t-black--light) span[aria-hidden='true']"));

    return { title: title.trim(), company: company.trim() };
  }

  function parseJsonLdPerson() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "");
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const type = item?.["@type"];
          const isPerson = type === "Person" || (Array.isArray(type) && type.includes("Person"));
          if (!isPerson) continue;
          return {
            name: cleanPersonName(item.name),
            linkedin_url: normalizeLinkedInURL(item.url || item.sameAs || location.href),
            title: String(item.jobTitle || "").trim(),
            company: String(item.worksFor?.name || "").trim()
          };
        }
      } catch {
        // ignore invalid JSON-LD blocks
      }
    }
    return null;
  }

  function parseProfilePage() {
    if (!isProfilePage(location.pathname)) return [];

    const linkedin_url = profileUrlFromPath(location.pathname) || normalizeLinkedInURL(location.href);

    const jsonLd = parseJsonLdPerson();
    const ogTitle = metaContent('meta[property="og:title"]');
    const nameFromOg = cleanPersonName(ogTitle.split("|")[0]);

    const name =
      cleanPersonName(jsonLd?.name) ||
      cleanPersonName(text(document.querySelector("h1.text-heading-xlarge"))) ||
      cleanPersonName(text(document.querySelector("h1.inline.t-24"))) ||
      cleanPersonName(text(document.querySelector("h1"))) ||
      cleanPersonName(text(document.querySelector(".pv-text-details__left-panel h1"))) ||
      cleanPersonName(text(document.querySelector("main h1"))) ||
      cleanPersonName(text(document.querySelector("[data-anonymize='person-name']"))) ||
      cleanPersonName(text(document.querySelector("[data-view-name='profile-top-card'] h1"))) ||
      nameFromOg ||
      nameFromDocumentTitle() ||
      nameFromSlug(linkedin_url);

    const headline =
      text(document.querySelector(".text-body-medium")) ||
      text(document.querySelector(".pv-text-details__left-panel .text-body-medium")) ||
      text(document.querySelector("[data-anonymize='headline']")) ||
      text(document.querySelector("[data-generated-suggestion-target]")) ||
      String(jsonLd?.title || "").trim() ||
      metaContent('meta[property="og:description"]');

    const { title, company: companyFromHeadline } = splitHeadline(headline);
    const experience = parseCurrentExperience();
    let titleResolved = title || experience.title;
    let company = companyFromHeadline || String(jsonLd?.company || "").trim() || experience.company;

    const locationText =
      text(document.querySelector(".text-body-small.inline.t-black--light.break-words")) ||
      text(document.querySelector("span.text-body-small.inline")) ||
      text(document.querySelector("[data-anonymize='location']")) ||
      text(document.querySelector(".pv-text-details__left-panel .text-body-small"));

    const websiteAnchor =
      document.querySelector('a[href^="http"]:not([href*="/in/"]):not([href*="/company/"])') ||
      document.querySelector("a[data-field='website']");
    const website = websiteFromAnchor(websiteAnchor) || "";

    const contact = extractContactFields();
    const about = parseProfileAbout();

    if (!linkedin_url || !name) return [];
    return [
      normalizeLead({
        name,
        linkedin_url,
        headline,
        title: titleResolved,
        company,
        location: locationText,
        email: contact.email,
        phone: contact.phone,
        website: contact.website || website,
        about
      })
    ];
  }

  function parseContactOverlay() {
    const slug = profileSlugFromUrl(location.pathname);
    const linkedin_url = slug ? `https://www.linkedin.com/in/${slug}/` : normalizeLinkedInURL(location.href);
    const contact = extractContactFields();
    if (!linkedin_url) return null;
    return normalizeLead({
      linkedin_url,
      profile_url: linkedin_url,
      email: contact.email,
      phone: contact.phone,
      website: contact.website
    });
  }

  function cleanSearchEntityName(value) {
    return cleanPersonName(
      String(value || "")
        .replace(/\s*[·•].*$/, "")
        .replace(/\s+(Follow|Takip et|Message|Mesaj|Connect|Bağlantı kur)$/i, "")
    );
  }

  function parseSearchResults() {
    const byUrl = new Map();

    function pushLead({ rawName, linkedin_url, subtitle, locationText, isCompany }) {
      if (!linkedin_url || byUrl.has(linkedin_url)) return;
      let pathname = "";
      try {
        pathname = new URL(linkedin_url).pathname;
      } catch {
        return;
      }
      if (!isImportableEntityPath(pathname)) return;

      const companyResult = isCompany || isCompanyPath(pathname);
      const name = companyResult
        ? cleanSearchEntityName(rawName) || companySlugFromPath(pathname).replace(/-/g, " ")
        : cleanSearchEntityName(rawName) || nameFromSlug(linkedin_url);
      if (!name || name.length < 2) return;

      const { title, company } = splitHeadline(subtitle || "");
      byUrl.set(
        linkedin_url,
        normalizeLead({
          name,
          linkedin_url,
          profile_url: linkedin_url,
          headline: subtitle || "",
          title: companyResult ? title || subtitle || "" : title,
          company: companyResult ? name : company,
          location: locationText || ""
        })
      );
    }

    function entityLinkFromCard(card) {
      return (
        card.querySelector("a[href*='/in/'][aria-label]") ||
        card.querySelector("a[href*='/company/'][aria-label]") ||
        card.querySelector("a.app-aware-link[href*='/in/']") ||
        card.querySelector("a.app-aware-link[href*='/company/']") ||
        card.querySelector("span.entity-result__title-text a") ||
        card.querySelector("a[href*='/in/']") ||
        card.querySelector("a[href*='/company/']")
      );
    }

    function nameFromCard(card, link) {
      return (
        cleanSearchEntityName(link?.getAttribute("aria-label")) ||
        cleanSearchEntityName(text(link?.querySelector("span[aria-hidden='true']"))) ||
        cleanSearchEntityName(text(link)) ||
        cleanSearchEntityName(text(card.querySelector(".entity-result__title-text"))) ||
        cleanSearchEntityName(text(card.querySelector("[data-anonymize='person-name']"))) ||
        cleanSearchEntityName(text(card.querySelector("[data-anonymize='company-name']"))) ||
        cleanSearchEntityName(text(card.querySelector("[data-test-app-aware-link]")))
      );
    }

    const cardSelectors = [
      "[data-view-name='search-entity-result-universal-template']",
      ".entity-result__item",
      ".reusable-search__result-container",
      "li.reusable-search__entity-result-list__item",
      "[data-chameleon-result-urn]",
      ".search-results-container li",
      "div[data-chameleon-result-urn]",
      "ul.reusable-search__entity-result-list > li",
      ".artdeco-list__item",
      "li.artdeco-list__item",
      "[data-x--search-result]",
      ".search-results__result-item",
      ".pv5",
      "tr.ember-view",
      ".scaffold-finite-scroll__content li"
    ];

    const processed = new WeakSet();
    for (const selector of cardSelectors) {
      document.querySelectorAll(selector).forEach((card) => {
        if (processed.has(card)) return;
        processed.add(card);
        const link = entityLinkFromCard(card);
        const linkedin_url = normalizeLinkedInURL(link?.getAttribute("href"));
        if (!linkedin_url) return;

        const subtitle =
          text(card.querySelector(".entity-result__primary-subtitle")) ||
          text(card.querySelector(".entity-result__summary")) ||
          text(card.querySelector("[data-anonymize='headline']")) ||
          text(card.querySelector(".t-14.t-black.t-normal"));

        const locationText =
          text(card.querySelector(".entity-result__secondary-subtitle")) ||
          text(card.querySelector("[data-anonymize='location']"));

        pushLead({
          rawName: nameFromCard(card, link),
          linkedin_url,
          subtitle,
          locationText,
          isCompany: /\/company\//i.test(linkedin_url)
        });
      });
    }

    if (byUrl.size === 0) {
      harvestSearchEntityLinks(byUrl);
    }

    return Array.from(byUrl.values());
  }

  function harvestSearchEntityLinks(byUrl = new Map()) {
    document.querySelectorAll("a[href*='/in/'], a[href*='/company/']").forEach((link) => {
      const linkedin_url = normalizeLinkedInURL(link.getAttribute("href"));
      if (!linkedin_url || byUrl.has(linkedin_url)) return;
      let pathname = "";
      try {
        pathname = new URL(linkedin_url).pathname;
      } catch {
        return;
      }
      if (!isImportableEntityPath(pathname)) return;

      const card = link.closest("li") || link.closest(".entity-result__item") || link.parentElement;
      const isCompany = isCompanyPath(pathname);
      const name = isCompany
        ? cleanSearchEntityName(link.getAttribute("aria-label")) ||
          cleanSearchEntityName(text(link)) ||
          companySlugFromPath(pathname).replace(/-/g, " ")
        : resolveConnectionName(link, card, linkedin_url).name;
      if (!name) return;

      byUrl.set(
        linkedin_url,
        normalizeLead({
          name,
          linkedin_url,
          profile_url: linkedin_url,
          company: isCompany ? name : "",
          title: "",
          location: ""
        })
      );
    });
    return Array.from(byUrl.values());
  }

  function harvestProfileLinks(seen = new Set()) {
    const leads = [];

    document.querySelectorAll("a[href*='/in/']").forEach((link) => {
      const linkedin_url = normalizeLinkedInURL(link.getAttribute("href"));
      if (!linkedin_url || seen.has(linkedin_url)) return;
      try {
        if (!isProfilePath(new URL(linkedin_url).pathname)) return;
      } catch {
        return;
      }

      const name = resolveConnectionName(link, link.closest("li") || link.parentElement, linkedin_url).name;
      if (!name) return;

      seen.add(linkedin_url);
      leads.push({ name, linkedin_url, title: "", company: "", location: "" });
    });

    return leads;
  }

  function parseSearchFromDom(seen = new Set()) {
    return parseSearchResults().filter((lead) => {
      if (!lead.linkedin_url || seen.has(lead.linkedin_url)) return false;
      seen.add(lead.linkedin_url);
      return true;
    });
  }

  function parseConnectionsFromDom(seen = new Set()) {
    const byUrl = new Map();
    const processedCards = new WeakSet();

    function pushConnection(lead) {
      const normalized = normalizeLead(lead);
      if (!normalized.linkedin_url || !normalized.name || seen.has(normalized.linkedin_url)) return;
      try {
        if (!isProfilePath(new URL(normalized.linkedin_url).pathname)) return;
      } catch {
        return;
      }
      if (isLikelyUsernameSlug(normalized.name, normalized.linkedin_url)) return;
      seen.add(normalized.linkedin_url);
      const existing = byUrl.get(normalized.linkedin_url);
      byUrl.set(normalized.linkedin_url, existing ? mergeLead(existing, normalized) : normalized);
    }

    function scanCard(card) {
      if (!card || processedCards.has(card)) return;
      processedCards.add(card);
      const parsed = parseConnectionCard(card);
      if (parsed) pushConnection(parsed);
    }

    const cardSelectors = [
      "[data-view-name='connections-profile']",
      "[data-view-name='connection-card']",
      "li.mn-connection-card",
      "div.mn-connection-card",
      ".mn-connections__connection-card",
      "[data-view-name='connections-list'] > div",
      "[data-view-name='connections-list'] li",
      "main .scaffold-finite-scroll__content > ul > li",
      "main .scaffold-finite-scroll__content > div > div",
      ".artdeco-list__item",
      ".entity-collection-item"
    ];

    for (const selector of cardSelectors) {
      document.querySelectorAll(selector).forEach(scanCard);
    }

    document.querySelectorAll("a[href*='/in/']").forEach((link) => {
      const row =
        link.closest("[data-view-name='connections-profile']") ||
        link.closest("li") ||
        link.closest("div.mn-connection-card") ||
        link.closest(".artdeco-list__item") ||
        link.closest(".entity-collection-item");
      if (row) {
        scanCard(row);
        return;
      }

      const linkedin_url = normalizeLinkedInURL(link.getAttribute("href"));
      const resolved = resolveConnectionName(link, row, linkedin_url);
      if (!resolved.name) return;
      pushConnection({
        name: resolved.name,
        linkedin_url,
        headline: resolved.headlineHint || ""
      });
    });

    return Array.from(byUrl.values());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findConnectionsScrollContainer() {
    const candidates = [
      document.querySelector(".scaffold-finite-scroll__content")?.parentElement,
      document.querySelector(".scaffold-finite-scroll"),
      document.querySelector('[data-view-name="connections-list"]')?.parentElement,
      document.querySelector(".search-results-container")?.closest("main"),
      document.querySelector(".search-marvel-srp")?.parentElement,
      document.querySelector("main")
    ].filter(Boolean);

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const isScrollable = style.overflowY === "auto" || style.overflowY === "scroll";
      if (isScrollable && el.scrollHeight > el.clientHeight + 80) return el;
    }
    return null;
  }

  function scrollConnectionsList() {
    const cardSelectors = [
      "[data-view-name='connections-profile']",
      "li.mn-connection-card",
      "div.mn-connection-card",
      ".mn-connections__connection-card",
      "[data-view-name='connections-list'] li",
      ".artdeco-list__item",
      ".entity-result__item",
      "[data-view-name='search-entity-result-universal-template']",
      "li.reusable-search__entity-result-list__item",
      ".reusable-search__result-container"
    ].join(", ");

    const cards = document.querySelectorAll(cardSelectors);
    const lastCard = cards[cards.length - 1];
    
    // 1. Scroll the last card into view smoothly to trigger lazy-loading naturally
    if (lastCard) {
      lastCard.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }

    // 2. Click any "load more" / "show more" buttons if they exist
    const loadMoreSelectors = [
      "button.scaffold-finite-scroll__load-button",
      "button.scaffold-finite-scroll__load-button--wide",
      "button[aria-label*='Load more']",
      "button[aria-label*='Daha fazla']",
      "button[aria-label*='Show more']",
      "button[aria-label*='Göster']",
      "button.artdeco-pagination__button--next:not([disabled])",
      "button[aria-label*='Next']",
      "button[aria-label*='Sonraki']",
      "li.artdeco-pagination__indicator--number.active + li button"
    ];
    for (const selector of loadMoreSelectors) {
      const loadMore = document.querySelector(selector);
      if (loadMore instanceof HTMLButtonElement && !loadMore.disabled) {
        loadMore.click();
        break;
      }
    }

    // 3. Perform a smooth scroll-by to trigger the window's intersection observers
    const container = findConnectionsScrollContainer();
    if (container && container !== document.documentElement && container !== document.body) {
      const step = Math.max(container.clientHeight * 0.75, 300);
      container.scrollBy({ top: step, behavior: "smooth" });
    } else {
      window.scrollBy({ top: 400, behavior: "smooth" });
    }
  }

  async function importConnectionsWithScroll(options = {}) {
    const maxScrolls = Number(options.maxScrolls) || 100;
    const pauseMs = Number(options.pauseMs) || 1000;
    const maxLeads = Number(options.maxLeads) || 1000;

    const byUrl = new Map();

    function mergeDom() {
      const seen = new Set(byUrl.keys());
      for (const lead of parseConnectionsFromDom(seen)) {
        const key = lead.linkedin_url;
        if (!key) continue;
        byUrl.set(key, byUrl.has(key) ? mergeLead(byUrl.get(key), lead) : lead);
      }
    }

    mergeDom();
    let staleRounds = 0;

    for (let i = 0; i < maxScrolls; i += 1) {
      const before = byUrl.size;
      scrollConnectionsList();
      await sleep(pauseMs);
      mergeDom();

      if (byUrl.size >= maxLeads) break;
      if (byUrl.size === before) {
        staleRounds += 1;
        if (staleRounds >= 8) break;
      } else {
        staleRounds = 0;
      }
    }

    return {
      leads: Array.from(byUrl.values()).slice(0, maxLeads),
      page_url: location.href,
      page_type: "connections",
      scrolled: true,
      total_found: byUrl.size
    };
  }

  async function importSearchWithScroll(options = {}) {
    const maxScrolls = Number(options.maxScrolls) || 80;
    const pauseMs = Number(options.pauseMs) || 1000;
    const maxLeads = Number(options.maxLeads) || 500;

    const byUrl = new Map();

    function mergeDom() {
      for (const lead of parseSearchResults()) {
        const key = lead.linkedin_url;
        if (!key) continue;
        byUrl.set(key, byUrl.has(key) ? mergeLead(byUrl.get(key), lead) : lead);
      }
    }

    mergeDom();
    let staleRounds = 0;

    for (let i = 0; i < maxScrolls; i += 1) {
      const before = byUrl.size;
      scrollConnectionsList();
      await sleep(pauseMs);
      mergeDom();

      if (byUrl.size >= maxLeads) break;
      if (byUrl.size === before) {
        staleRounds += 1;
        if (staleRounds >= 8) break;
      } else {
        staleRounds = 0;
      }
    }

    return {
      leads: Array.from(byUrl.values()).slice(0, maxLeads),
      page_url: location.href,
      page_type: "search",
      scrolled: true,
      total_found: byUrl.size
    };
  }

  function parseCompanyPage() {
    const linkedin_url = normalizeLinkedInURL(location.href);
    if (!isCompanyPath(location.pathname)) return [];

    const name =
      cleanPersonName(text(document.querySelector("h1"))) ||
      cleanPersonName(text(document.querySelector(".org-top-card-summary__title"))) ||
      cleanPersonName(metaContent('meta[property="og:title"]').split("|")[0]) ||
      nameFromDocumentTitle();

    const category =
      text(document.querySelector(".org-top-card-summary__industry")) ||
      text(document.querySelector(".org-about-company-module__company-staff-count-range"));

    const locationText = text(document.querySelector(".org-top-card-summary__info-item"));

    const websiteEl = document.querySelector("a[href^='http']:not([href*='linkedin.com'])");
    const website = websiteEl?.getAttribute("href") || "";

    if (!name) return [];
    return [{ name, linkedin_url, company: name, title: category, location: locationText, website }];
  }

  function detectPageType() {
    if (isConnectionsPage(location.pathname)) return "connections";
    if (isCompanyPeoplePath(location.pathname)) return "company_people";
    if (isCompanyPath(location.pathname)) return "company";
    if (isProfilePage(location.pathname)) return "profile";
    if (isSearchPage(location.pathname)) return "search";
    if (location.pathname.includes("/feed")) return "feed";
    return "other";
  }

  function collectLeads() {
    const pageType = detectPageType();
    let leads = [];

    if (pageType === "connections") {
      leads = parseConnectionsFromDom();
    } else if (pageType === "company") {
      leads = parseCompanyPage();
    } else if (pageType === "profile") {
      leads = parseProfilePage();
    } else if (pageType === "search" || pageType === "company_people") {
      leads = parseSearchResults();
    } else {
      leads = parseSearchResults();
    }

    if (leads.length === 0) {
      leads = harvestProfileLinks();
    }

    return leads;
  }

  globalThis.liImportLinkedInCollect = function liImportLinkedInCollect() {
    const gate = detectPageGate();
    if (!gate.ok) {
      return {
        provider: "linkedin",
        leads: [],
        page_url: location.href,
        page_type: detectPageType(),
        error: gate.error || "page_blocked"
      };
    }

    const page_type = detectPageType();
    const leads = collectLeads().map((lead) => normalizeLead(lead));

    if (
      leads.length === 0 &&
      (page_type === "search" || page_type === "company_people") &&
      globalThis.LiImportLinkedInCore?.isSearchEmpty?.(document)
    ) {
      return {
        provider: "linkedin",
        leads: [],
        page_url: location.href,
        page_type,
        error: "search_empty"
      };
    }

    return { provider: "linkedin", leads, page_url: location.href, page_type };
  };

  globalThis.liImportLinkedInPageGate = function liImportLinkedInPageGate() {
    return detectPageGate();
  };

  globalThis.liImportLinkedInParseConnections = function liImportLinkedInParseConnections() {
    return parseConnectionsFromDom().map((lead) => normalizeLead(lead));
  };

  globalThis.liImportLinkedInParseSearch = function liImportLinkedInParseSearch() {
    return parseSearchFromDom().map((lead) => normalizeLead(lead));
  };

  globalThis.liImportLinkedInParseProfile = async function liImportLinkedInParseProfile() {
    if (/\/overlay\/contact-info/i.test(location.pathname)) {
      return parseContactOverlay();
    }
    if (!isProfilePage(location.pathname)) return null;

    const baseLead = parseProfilePage()[0];
    if (!baseLead) return null;

    const beforeModal = extractContactFields();
    await openContactInfoModal();
    const fromModal = extractContactFields();

    const contact = {
      email: fromModal.email || beforeModal.email,
      phone: fromModal.phone || beforeModal.phone,
      website: fromModal.website || beforeModal.website
    };

    return normalizeLead({
      ...baseLead,
      email: contact.email || baseLead.email,
      phone: contact.phone || baseLead.phone,
      website: contact.website || baseLead.website,
      about: baseLead.about || parseProfileAbout()
    });
  };

  globalThis.liImportLinkedInParseContactOverlay = function liImportLinkedInParseContactOverlay() {
    return parseContactOverlay();
  };

  globalThis.liImportLinkedInContactOverlayUrl = contactOverlayUrl;

  globalThis.liImportLinkedInMergeLead = mergeLead;
  globalThis.liImportLinkedInLeadNeedsEnrich = leadNeedsEnrich;
  globalThis.liImportLinkedInScrollOnce = scrollConnectionsList;

  // Legacy aliases (remove after migration window)
  globalThis.liImportCollectLinkedInLeads = globalThis.liImportLinkedInCollect;
  globalThis.liImportParseConnectionsFromDom = globalThis.liImportLinkedInParseConnections;
  globalThis.liImportScrollConnectionsOnce = globalThis.liImportLinkedInScrollOnce;
  globalThis.liImportImportLinkedInConnections = importConnectionsWithScroll;
  globalThis.liImportImportLinkedInSearch = importSearchWithScroll;
})();
