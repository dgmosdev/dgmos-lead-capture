/**
 * Pure LinkedIn helpers (browser + Node tests).
 * Loaded before collector.js in content/background inject paths.
 */
(function registerLiImportLinkedInCore(root) {
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
    const match = String(pathname || "").match(/^\/in\/([^/?#]+)/i);
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
    return isProfilePage(pathname) && /^\/in\/[^/?#]+\/?$/i.test(String(pathname || ""));
  }

  function isCompanyPath(pathname) {
    // Overview or About — not People / Jobs / Posts.
    return /^\/company\/[^/?#]+\/?(?:about\/?)?$/i.test(String(pathname || ""));
  }

  function isCompanyPeoplePath(pathname) {
    return /^\/company\/[^/?#]+\/people\/?/i.test(String(pathname || ""));
  }

  function isConnectionsPath(pathname) {
    const p = String(pathname || "");
    return (
      p.includes("/mynetwork/invite-connect/connections") ||
      p.includes("/mynetwork/connections") ||
      /^\/connections\/?$/i.test(p)
    );
  }

  function isSalesNavigatorPath(pathname) {
    return String(pathname || "").includes("/sales/");
  }

  function isRecruiterPath(pathname) {
    const p = String(pathname || "");
    return p.includes("/talent/") || p.includes("/recruiter/");
  }

  function isSearchPath(pathname) {
    const p = String(pathname || "");
    return p.includes("/search/") || isCompanyPeoplePath(p) || isSalesNavigatorPath(p) || isRecruiterPath(p);
  }

  function detectImportModeFromPath(pathname) {
    if (isConnectionsPath(pathname)) return "connections";
    if (isSearchPath(pathname)) return "search";
    return "quick";
  }

  function detectPageGate(doc, href) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    let pathname = "";
    try {
      pathname = new URL(href || (typeof location !== "undefined" ? location.href : ""), "https://www.linkedin.com")
        .pathname;
    } catch {
      pathname = "";
    }

    if (/\/login|\/uas\/login|\/checkpoint\/|\/authwall/i.test(pathname)) {
      return { ok: false, error: "login_required" };
    }

    if (!documentRef) return { ok: true, error: "" };

    const challenge =
      documentRef.querySelector(".challenge-dialog") ||
      documentRef.querySelector("#captcha-challenge") ||
      documentRef.querySelector('[data-test-id="challenge-form"]') ||
      documentRef.querySelector(".captcha-challenge") ||
      documentRef.querySelector('iframe[src*="challenge"]');
    if (challenge) {
      return { ok: false, error: "challenge_required" };
    }

    const bodyText = String(documentRef.body?.innerText || "").slice(0, 4000);
    if (
      /sign in to (view|continue)|linkedin'?e giriş yap|oturum açın|join linkedin|ücretsiz katıl/i.test(bodyText) &&
      !documentRef.querySelector("a[href*='/in/'], a[href*='/company/'], .entity-result__item, .mn-connection-card")
    ) {
      return { ok: false, error: "login_required" };
    }

    return { ok: true, error: "" };
  }

  function leadProfileUrl(lead) {
    if (!lead) return "";
    return String(lead.profile_url || lead.linkedin_url || "").trim();
  }

  function normalizeLeadsForApi(rawLeads) {
    return (rawLeads || []).map((lead) => {
      const title = String(lead.title || lead.headline || "").trim();
      const company = String(lead.company || "").trim();
      const enrichStatus = String(lead.enrich_status || "")
        .trim()
        .toLowerCase();
      return {
        name: lead.name,
        profile_url: leadProfileUrl(lead),
        linkedin_url: lead.linkedin_url || undefined,
        title: title || undefined,
        company: company || undefined,
        location: lead.location || undefined,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        website: lead.website || undefined,
        headline: lead.headline || undefined,
        about: lead.about || undefined,
        enrich_status: enrichStatus === "enriched" || enrichStatus === "listed" ? enrichStatus : undefined
      };
    });
  }

  function isSearchEmpty(doc) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef) return false;
    return Boolean(
      documentRef.querySelector(".search-reusable-empty-state") ||
        documentRef.querySelector(".artdeco-empty-state") ||
        documentRef.querySelector('[data-test-search-empty-state]') ||
        documentRef.querySelector(".search-no-results")
    );
  }

  const api = {
    normalizeLinkedInURL,
    profileSlugFromPath,
    isProfilePage,
    isProfilePath,
    isCompanyPath,
    isCompanyPeoplePath,
    isConnectionsPath,
    isSearchPath,
    isSalesNavigatorPath,
    isRecruiterPath,
    detectImportModeFromPath,
    detectPageGate,
    isSearchEmpty,
    leadProfileUrl,
    normalizeLeadsForApi
  };

  root.LiImportLinkedInCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
