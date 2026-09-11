(function registerLiImportProviders() {
  const cfg = globalThis.LI_IMPORT_CONFIG || {};
  const brand = cfg.brandName || "Dgmos";
  const limits = cfg.limits || {};
  const connectionsMax = limits.connections || 2500;
  const searchMax = limits.search || 800;
  const resolveFeatures =
    typeof globalThis.liImportResolveFeatures === "function"
      ? globalThis.liImportResolveFeatures
      : () => ({ enrichEnabled: cfg.enrichProfiles !== false, aiEnabled: false });
  const bootstrapFeatures = resolveFeatures(cfg, null);
  // Provider scrape.enrichProfiles = INLINE enrich during scan (usually false).
  const enrichProfiles = bootstrapFeatures.enrichEnabled;
  const backgroundEnrich = bootstrapFeatures.backgroundEnrichEnabled;
  const enrichOnlyMissing = cfg.enrichOnlyMissing !== false;
  const enrichPauseMs = cfg.enrichPauseMs || 5500;
  const enrichPauseJitter = cfg.enrichPauseJitter ?? 0.35;
  const enrichBatchSize = cfg.enrichBatchSize || 8;
  const enrichBatchPauseMs = cfg.enrichBatchPauseMs || 25000;
  const enrichBatchPauseJitter = cfg.enrichBatchPauseJitter ?? 0.2;
  const enrichSessionMax = cfg.enrichSessionMax || 80;
  const enrichDailyMax = cfg.enrichDailyMax || 120;
  const enrichMax = limits.enrichMax || connectionsMax;

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
        enrichProfiles,
        enrichOnlyMissing,
        enrichPauseMs,
        enrichPauseJitter,
        enrichBatchSize,
        enrichBatchPauseMs,
        enrichBatchPauseJitter,
        enrichSessionMax,
        enrichDailyMax,
        enrichMax
      },
      scrapeSearch: {
        maxRounds: 80,
        pauseMs: 1500,
        maxLeads: searchMax,
        staleLimit: 14,
        enrichProfiles,
        enrichOnlyMissing,
        enrichPauseMs,
        enrichPauseJitter,
        enrichBatchSize,
        enrichBatchPauseMs,
        enrichBatchPauseJitter,
        enrichSessionMax,
        enrichDailyMax,
        enrichMax: Math.min(enrichMax, searchMax)
      },
      api: {
        collect: "liImportLinkedInCollect",
        parseConnections: "liImportLinkedInParseConnections",
        parseSearch: "liImportLinkedInParseSearch",
        parseProfile: "liImportLinkedInParseProfile",
        pageGate: "liImportLinkedInPageGate",
        mergeLead: "liImportLinkedInMergeLead",
        leadNeedsEnrich: "liImportLinkedInLeadNeedsEnrich",
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
      defaultImportMode: "search",
      pickerDescription: `Search LinkedIn or import connections into ${brand}`,
      ui: {
        importTitle: `LinkedIn → ${brand}`,
        importSubtitleConnections: enrichProfiles
          ? `List all connections first, save them, then enrich a small ban-safe batch (max ${enrichSessionMax}/session).`
          : backgroundEnrich
            ? `Save the full connections list first. Ban-safe detail enrich runs later in the background.`
            : `Import your LinkedIn connections into ${brand} without opening profile pages.`,
        importSubtitleSearch: enrichProfiles
          ? `Scan the full result list first, then enrich up to ${enrichSessionMax} profiles slowly in order.`
          : backgroundEnrich
            ? `Save all search results first. Detail enrich is queued in the background (not immediately).`
            : "Search LinkedIn, open Sales Nav / Talent / company People, then scan. Prefer Connections.csv for large networks.",
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
        stepsConnections: enrichProfiles
          ? [
              { key: "scroll", label: "Listing connections" },
              { key: "parse", label: "Merging list fields" },
              { key: "enrich", label: `Slow enrich pages (≤${enrichSessionMax}/session)` },
              { key: "ready", label: "Ready to save" },
              { key: "send", label: `Saving to ${brand}` }
            ]
          : backgroundEnrich
            ? [
                { key: "scroll", label: "Listing connections" },
                { key: "parse", label: "Merging list fields" },
                { key: "ready", label: "Saved — background enrich queued" },
                { key: "send", label: `Saving to ${brand}` }
              ]
            : [
              { key: "scroll", label: "Scrolling list" },
              { key: "parse", label: "Reading title and company" },
              { key: "ready", label: "List ready" },
              { key: "send", label: `Saving to ${brand}` }
            ],
        stepsSearch: enrichProfiles
          ? [
              { key: "scroll", label: "Listing results" },
              { key: "parse", label: "Merging list fields" },
              { key: "enrich", label: `Slow enrich pages (≤${enrichSessionMax}/session)` },
              { key: "ready", label: "Ready to save" },
              { key: "send", label: `Saving to ${brand}` }
            ]
          : backgroundEnrich
            ? [
                { key: "scroll", label: "Listing results" },
                { key: "parse", label: "Merging list fields" },
                { key: "ready", label: "Saved — background enrich queued" },
                { key: "send", label: `Saving to ${brand}` }
              ]
            : [
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
          parsing: "Merging list fields…",
          enriching: backgroundEnrich && !enrichProfiles
            ? "Background enrich planned (not starting now)…"
            : `Enriching slowly (≤${enrichSessionMax}/session)…`,
          scanningQuick: "Scanning page…",
          ready: backgroundEnrich && !enrichProfiles
            ? "List saved — enrich queued for later"
            : "Ready to save",
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

  function withRuntimeFeatures(provider, sessionFeatures) {
    if (!provider) return null;
    const features = resolveFeatures(cfg, sessionFeatures);
    const enrich = features.enrichEnabled;
    const backgroundEnrich = features.backgroundEnrichEnabled;
    return {
      ...provider,
      scrape: { ...provider.scrape, enrichProfiles: enrich },
      scrapeSearch: provider.scrapeSearch
        ? { ...provider.scrapeSearch, enrichProfiles: enrich }
        : provider.scrapeSearch,
      features,
      ui: {
        ...provider.ui,
        stepsConnections: enrich
          ? provider.ui.stepsConnections
          : backgroundEnrich
            ? [
                { key: "scroll", label: "Listing connections" },
                { key: "parse", label: "Merging list fields" },
                { key: "ready", label: "Saved — background enrich queued" },
                { key: "send", label: `Saving to ${brand}` }
              ]
            : [
              { key: "scroll", label: "Listing connections" },
              { key: "parse", label: "Reading list fields" },
              { key: "ready", label: "List ready" },
              { key: "send", label: `Saving to ${brand}` }
            ],
        stepsSearch: enrich
          ? provider.ui.stepsSearch
          : backgroundEnrich
            ? [
                { key: "scroll", label: "Listing results" },
                { key: "parse", label: "Merging list fields" },
                { key: "ready", label: "Saved — background enrich queued" },
                { key: "send", label: `Saving to ${brand}` }
              ]
            : [
              { key: "scroll", label: "Listing results" },
              { key: "parse", label: "Reading list fields" },
              { key: "ready", label: "Ready to save" },
              { key: "send", label: `Saving to ${brand}` }
            ],
        phase: {
          ...provider.ui.phase,
          enriching: enrich
            ? provider.ui.phase.enriching
            : backgroundEnrich
              ? "Background enrich planned (not starting now)…"
              : "Enrich skipped",
          ready: backgroundEnrich && !enrich
            ? "List saved — enrich queued for later"
            : provider.ui.phase.ready
        }
      }
    };
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
    withRuntimeFeatures,
    resolveFeatures: (sessionFeatures) => resolveFeatures(cfg, sessionFeatures),
    listAllProviders,
    listEnabledProviders,
    detectProvider,
    detectProviderAny
  };
})();
