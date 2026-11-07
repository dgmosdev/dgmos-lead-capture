(function registerLiImportProviders() {
  const cfg = globalThis.LI_IMPORT_CONFIG || {};
  const brand = cfg.brandName || "Dgmos";
  const t =
    globalThis.DgmosI18n?.t ||
    ((text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text));
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
      pickerDescription: t("Search LinkedIn or import connections into {brand}", { brand }),
      ui: {
        importTitle: t("LinkedIn → {brand}", { brand }),
        importSubtitleConnections: enrichProfiles
          ? t("List all connections first, save them, then enrich a small ban-safe batch (max {enrichSessionMax}/session).", { enrichSessionMax })
          : backgroundEnrich
            ? t("Save the full connections list first. Ban-safe detail enrich runs later in the background.")
            : t("Import your LinkedIn connections into {brand} without opening profile pages.", { brand }),
        importSubtitleSearch: enrichProfiles
          ? t("Scan the full result list first, then enrich up to {enrichSessionMax} profiles slowly in order.", { enrichSessionMax })
          : backgroundEnrich
            ? t("Save all search results first. Detail enrich is queued in the background (not immediately).")
            : t("Search LinkedIn, open Sales Nav / Talent / company People, then scan. Prefer Connections.csv for large networks."),
        importSubtitleQuick: t("Quickly import profiles from this page."),
        setupTitle: t("Go to Connections page"),
        setupText: t("Open LinkedIn → My Network → Connections, then start importing."),
        setupTitleSearch: t("Run a LinkedIn search"),
        setupTextSearch:
          t("Open LinkedIn search, Sales Nav, Talent, or company → People, then press Scan."),
        openEntryLabel: t("Open Connections page"),
        openSearchLabel: t("Open LinkedIn search"),
        sendConnections: t("Save connections to {brand}", { brand }),
        sendSearch: t("Save search results to {brand}", { brand }),
        sendQuick: t("Save to {brand}", { brand }),
        entityConnections: t("connection"),
        entitySearch: t("result"),
        entityQuick: t("profile"),
        idleHint: t("Open Connections, run a search, or upload Connections.csv."),
        notOnProvider: t("You are not on the LinkedIn page."),
        loginRequired: t("Sign in to LinkedIn in this tab, then try again."),
        challengeRequired: t("Complete the LinkedIn security check, then rescan."),
        searchEmpty: t("No search results on this page. Try another query."),
        noLeadsFound: t("No importable profiles found on this page."),
        scanningConnections: t("Scanning connections…"),
        scanningSearch: t("Scanning search results…"),
        scanningQuick: t("Scanning page…"),
        stepsConnections: enrichProfiles
          ? [
              { key: "scroll", label: t("Listing connections") },
              { key: "parse", label: t("Merging list fields") },
              { key: "enrich", label: t("Slow enrich pages (≤{enrichSessionMax}/session)", { enrichSessionMax }) },
              { key: "ready", label: t("Ready to save") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ]
          : backgroundEnrich
            ? [
                { key: "scroll", label: t("Listing connections") },
                { key: "parse", label: t("Merging list fields") },
                { key: "ready", label: t("Saved — background enrich queued") },
                { key: "send", label: t("Saving to {brand}", { brand }) }
              ]
            : [
              { key: "scroll", label: t("Scrolling list") },
              { key: "parse", label: t("Reading title and company") },
              { key: "ready", label: t("List ready") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ],
        stepsSearch: enrichProfiles
          ? [
              { key: "scroll", label: t("Listing results") },
              { key: "parse", label: t("Merging list fields") },
              { key: "enrich", label: t("Slow enrich pages (≤{enrichSessionMax}/session)", { enrichSessionMax }) },
              { key: "ready", label: t("Ready to save") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ]
          : backgroundEnrich
            ? [
                { key: "scroll", label: t("Listing results") },
                { key: "parse", label: t("Merging list fields") },
                { key: "ready", label: t("Saved — background enrich queued") },
                { key: "send", label: t("Saving to {brand}", { brand }) }
              ]
            : [
              { key: "scroll", label: t("Scrolling results") },
              { key: "parse", label: t("Reading people and companies") },
              { key: "ready", label: t("Results ready") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ],
        stepsQuick: [
          { key: "scan", label: t("Scanning page") },
          { key: "ready", label: t("Profiles ready") },
          { key: "send", label: t("Saving to {brand}", { brand }) }
        ],
        phase: {
          idle: t("Scan to start"),
          scanning: t("Listing connections…"),
          scanningSearch: t("Listing search results…"),
          parsing: t("Merging list fields…"),
          enriching: backgroundEnrich && !enrichProfiles
            ? t("Background enrich planned (not starting now)…")
            : t("Enriching slowly (≤{enrichSessionMax}/session)…", { enrichSessionMax }),
          scanningQuick: t("Scanning page…"),
          ready: backgroundEnrich && !enrichProfiles
            ? t("List saved — enrich queued for later")
            : t("Ready to save"),
          sending: t("Saving to {brand}…", { brand }),
          done: t("Import completed"),
          error: t("Something went wrong")
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
                { key: "scroll", label: t("Listing connections") },
                { key: "parse", label: t("Merging list fields") },
                { key: "ready", label: t("Saved — background enrich queued") },
                { key: "send", label: t("Saving to {brand}", { brand }) }
              ]
            : [
              { key: "scroll", label: t("Listing connections") },
              { key: "parse", label: t("Reading list fields") },
              { key: "ready", label: t("List ready") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ],
        stepsSearch: enrich
          ? provider.ui.stepsSearch
          : backgroundEnrich
            ? [
                { key: "scroll", label: t("Listing results") },
                { key: "parse", label: t("Merging list fields") },
                { key: "ready", label: t("Saved — background enrich queued") },
                { key: "send", label: t("Saving to {brand}", { brand }) }
              ]
            : [
              { key: "scroll", label: t("Listing results") },
              { key: "parse", label: t("Reading list fields") },
              { key: "ready", label: t("Ready to save") },
              { key: "send", label: t("Saving to {brand}", { brand }) }
            ],
        phase: {
          ...provider.ui.phase,
          enriching: enrich
            ? provider.ui.phase.enriching
            : backgroundEnrich
              ? t("Background enrich planned (not starting now)…")
              : t("Enrich skipped"),
          ready: backgroundEnrich && !enrich
            ? t("List saved — enrich queued for later")
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
