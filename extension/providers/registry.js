(function registerLiImportProviders() {
  const cfg = globalThis.LI_IMPORT_CONFIG || {};
  const brand = cfg.brandName || "Dgmos";
  const limits = cfg.limits || {};
  const connectionsMax = limits.connections || 2500;
  const searchMax = limits.search || 800;

  const LINKEDIN_CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
  const LINKEDIN_SEARCH_URL = "https://www.linkedin.com/search/results/all/";

  const providers = {
    linkedin: {
      id: "linkedin",
      label: "LinkedIn",
      enabled: true,
      hostPattern: /https?:\/\/([a-z0-9-]+\.)?linkedin\.com/i,
      entryUrl: LINKEDIN_CONNECTIONS_URL,
      searchEntryUrl: LINKEDIN_SEARCH_URL,
      collectorFile: "providers/linkedin/collector.js",
      scrape: {
        maxRounds: 150,
        pauseMs: 1600,
        maxLeads: connectionsMax,
        staleLimit: 18,
        enrichProfiles: false
      },
      scrapeSearch: {
        maxRounds: 80,
        pauseMs: 1500,
        maxLeads: searchMax,
        staleLimit: 14,
        enrichProfiles: false
      },
      api: {
        collect: "liImportLinkedInCollect",
        parseConnections: "liImportLinkedInParseConnections",
        parseSearch: "liImportLinkedInParseSearch",
        pageGate: "liImportLinkedInPageGate",
        mergeLead: "liImportLinkedInMergeLead",
        scrollOnce: "liImportLinkedInScrollOnce"
      },
      detectImportMode(url) {
        if (!url) return "quick";
        try {
          const pathname = new URL(url).pathname;
          const core = globalThis.LiImportLinkedInCore;
          if (core?.detectImportModeFromPath) {
            return core.detectImportModeFromPath(pathname);
          }
          if (
            pathname.includes("/mynetwork/invite-connect/connections") ||
            pathname.includes("/mynetwork/connections") ||
            /^\/connections\/?$/i.test(pathname)
          ) {
            return "connections";
          }
          if (
            pathname.includes("/search/") ||
            /^\/company\/[^/]+\/people/i.test(pathname) ||
            pathname.includes("/sales/") ||
            pathname.includes("/talent/") ||
            pathname.includes("/recruiter/")
          ) {
            return "search";
          }
        } catch {
          return "quick";
        }
        return "quick";
      },
      importModes: ["connections", "search", "quick"],
      defaultImportMode: "connections",
      pickerDescription: `Import LinkedIn leads into ${brand}`,
      ui: {
        importTitle: `LinkedIn → ${brand}`,
        importSubtitleConnections: `Import your LinkedIn connections into ${brand} without opening profile pages.`,
        importSubtitleSearch:
          "Search LinkedIn, open Sales Nav / Talent / company People, then scan. Prefer Connections.csv for large networks.",
        importSubtitleQuick: "Quickly import profiles from this page.",
        setupTitle: "Go to Connections page",
        setupText: "Open LinkedIn → My Network → Connections, then start importing.",
        setupTitleSearch: "Run a LinkedIn search",
        setupTextSearch:
          "Open LinkedIn search, Sales Nav, Talent, or company → People, then press Scan.",
        openEntryLabel: "Open Connections page",
        openSearchLabel: "Open LinkedIn search",
        sendConnections: `Save connections to ${brand}`,
        sendSearch: `Save search results to ${brand}`,
        sendQuick: `Save to ${brand}`,
        entityConnections: "connection",
        entitySearch: "result",
        entityQuick: "profile",
        idleHint: "Open Connections, run a search, or upload Connections.csv.",
        notOnProvider: "You are not on the LinkedIn page.",
        loginRequired: "Sign in to LinkedIn in this tab, then try again.",
        challengeRequired: "Complete the LinkedIn security check, then rescan.",
        searchEmpty: "No search results on this page. Try another query.",
        noLeadsFound: "No importable profiles found on this page.",
        scanningConnections: "Scanning connections…",
        scanningSearch: "Scanning search results…",
        scanningQuick: "Scanning page…",
        stepsConnections: [
          { key: "scroll", label: "Scrolling list" },
          { key: "parse", label: "Reading title and company" },
          { key: "ready", label: "List ready" },
          { key: "send", label: `Saving to ${brand}` }
        ],
        stepsSearch: [
          { key: "scroll", label: "Scrolling results" },
          { key: "parse", label: "Reading people and companies" },
          { key: "ready", label: "Results ready" },
          { key: "send", label: `Saving to ${brand}` }
        ],
        stepsQuick: [
          { key: "scan", label: "Scanning page" },
          { key: "ready", label: "Profiles ready" },
          { key: "send", label: `Saving to ${brand}` }
        ],
        phase: {
          idle: "Scan to start",
          scanning: "Listing connections…",
          scanningSearch: "Listing search results…",
          parsing: "Reading details…",
          scanningQuick: "Scanning page…",
          ready: "Ready to save",
          sending: `Saving to ${brand}…`,
          done: "Import completed",
          error: "Something went wrong"
        }
      }
    }
  };

  function getProvider(id) {
    return providers[id] || null;
  }

  function listEnabledProviders() {
    return Object.values(providers).filter((provider) => provider.enabled);
  }

  function detectProvider(url) {
    if (!url) return null;
    for (const provider of listEnabledProviders()) {
      if (provider.hostPattern.test(url)) return provider;
    }
    return null;
  }

  function detectProviderAny(url) {
    return detectProvider(url);
  }

  function listAllProviders() {
    return Object.values(providers);
  }

  globalThis.liImportProviderRegistry = {
    providers,
    getProvider,
    listAllProviders,
    listEnabledProviders,
    detectProvider,
    detectProviderAny
  };
})();
