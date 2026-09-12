(function registerLiImportConfig() {
  const config = {
    brandName: "Dgmos",
    brandTag: "Lead Capture",
    tagline: "Capture profiles from the web and save them to your CRM.",
    tokenPrefix: "dgext_",
    defaultApiBase: "http://localhost:8088",
    prodApiBase: "http://localhost:8088",
    storagePrefix: "dgmos_",
    panelHostId: "dgmos-linkedin-panel-host",
    primaryColor: "#0B3A5B",
    accentColor: "#1F7A8C",

    // Empty / "none" = no AI provider → skip AI UI / AI pipeline.
    aiProvider: "",
    // Main product flow: list+save first. Do NOT enrich during the scan.
    inlineEnrichDuringScan: false,
    // After list is saved, plan ban-safe enrich later (not immediately).
    backgroundEnrichListed: true,
    // Wait before the first background enrich tick (minutes).
    backgroundEnrichDelayMinutes: 3,
    // Minutes between background enrich ticks.
    backgroundEnrichIntervalMinutes: 2,
    // When true, profile enrich only runs if an AI provider is configured.
    // Background listed enrich ignores this (detail visit ≠ AI analysis).
    skipEnrichWithoutAi: true,
    enrichProfiles: true,
    enrichOnlyMissing: true,
    enrichBatchSize: 6,
    enrichPauseMs: 5500,
    enrichPauseJitter: 0.35,
    // Keep under ~30s to reduce MV3 service-worker kill risk during rests.
    enrichBatchPauseMs: 25000,
    enrichBatchPauseJitter: 0.2,
    enrichSessionMax: 40,
    enrichDailyMax: 120,
    limits: {
      connections: 2500,
      search: 800,
      batch: 100,
      enrichMax: 2500
    }
  };

  function normalizeAiProvider(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (!raw || raw === "none" || raw === "off" || raw === "false" || raw === "0") return "";
    return raw;
  }

  /**
   * Resolve runtime feature flags from local config + optional host session.features.
   */
  function resolveFeatures(cfg = config, sessionFeatures = null) {
    const host = sessionFeatures && typeof sessionFeatures === "object" ? sessionFeatures : {};
    const provider = normalizeAiProvider(
      host.ai_provider != null ? host.ai_provider : cfg.aiProvider
    );
    let aiEnabled = Boolean(provider);
    if (host.ai === false) aiEnabled = false;
    if (host.ai === true) aiEnabled = true;

    // Inline enrich during scan (usually off — list first, enrich later).
    let inlineEnrich = cfg.inlineEnrichDuringScan === true && cfg.enrichProfiles !== false;
    let enrichPinned = false;
    if (host.enrich === false) {
      inlineEnrich = false;
      enrichPinned = true;
    }
    if (host.enrich === true) {
      inlineEnrich = true;
      enrichPinned = true;
    }
    const skipWithoutAi = cfg.skipEnrichWithoutAi !== false;
    if (!enrichPinned && inlineEnrich && skipWithoutAi && !aiEnabled) {
      inlineEnrich = false;
    }

    const backgroundEnrich =
      cfg.backgroundEnrichListed !== false && cfg.enrichProfiles !== false && host.enrich !== false;

    return {
      aiEnabled,
      enrichEnabled: inlineEnrich,
      backgroundEnrichEnabled: backgroundEnrich,
      inlineEnrichDuringScan: inlineEnrich,
      aiProvider: aiEnabled ? provider || String(host.ai_provider || cfg.aiProvider || "host").trim() : "",
      skipEnrichWithoutAi: skipWithoutAi
    };
  }

  globalThis.LI_IMPORT_CONFIG = config;
  globalThis.DGMOS_EXT_CONFIG = config;
  globalThis.liImportResolveFeatures = resolveFeatures;
  globalThis.liImportNormalizeAiProvider = normalizeAiProvider;
})();
