(function registerLiImportConfig() {
  const config = {
    brandName: "Dgmos",
    brandTag: "LinkedIn Import",
    tagline: "Import LinkedIn profiles and save them to your workspace.",
    tokenPrefix: "dgext_",
    defaultApiBase: "http://localhost:8088",
    prodApiBase: "http://localhost:8088",
    storagePrefix: "dgmos_",
    panelHostId: "dgmos-linkedin-panel-host",
    primaryColor: "#0B3A5B",
    accentColor: "#1F7A8C",
    limits: {
      connections: 2500,
      search: 800,
      batch: 100
    }
  };

  globalThis.LI_IMPORT_CONFIG = config;
  // Temporary alias for older local forks; prefer LI_IMPORT_CONFIG.
  globalThis.DGMOS_EXT_CONFIG = config;
})();
