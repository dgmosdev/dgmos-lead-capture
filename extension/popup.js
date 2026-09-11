const ext = globalThis.chrome ?? globalThis.browser;
const registry = globalThis.liImportProviderRegistry;
const cfg = globalThis.LI_IMPORT_CONFIG || {};
const DEFAULT_API_BASE = cfg.defaultApiBase || "http://localhost:8088";
const PROD_API_BASE = cfg.prodApiBase || DEFAULT_API_BASE;
const BATCH_SIZE = cfg.limits?.batch || 100;
const TOKEN_PREFIX = cfg.tokenPrefix || "dgext_";
const STORAGE_PREFIX = cfg.storagePrefix || "dgmos_";
const BRAND_NAME = cfg.brandName || "Dgmos";

const AUTH_ERRORS = {
  unauthorized: "Token is invalid or has been revoked.",
  network: "Could not reach the API. Please check the URL and your connection."
};

function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

function sessionWorkspaceName(sessionObj) {
  return sessionObj?.workspace_name || sessionObj?.organization_name || "";
}

const openEntryBtn = document.getElementById("openEntryBtn");
const csvFileInput = document.getElementById("csvFileInput");
const csvImportBtn = document.getElementById("csvImportBtn");
const headerSub = document.getElementById("headerSub");
const setupTitleEl = document.getElementById("setupTitle");
const setupTextEl = document.getElementById("setupText");
const setupCard = document.getElementById("setupCard");
const progressCard = document.getElementById("progressCard");
const activityLineEl = document.getElementById("activityLine");
const rescanBtn = document.getElementById("rescanBtn");
const cancelBtn = document.getElementById("cancelBtn");
const phaseTitleEl = document.getElementById("phaseTitle");
const stepsEl = document.getElementById("steps");
const progressFillEl = document.getElementById("progressFill");
const providerOptionsEl = document.getElementById("providerOptions");
const providerView = document.getElementById("providerView");
const linkedinFlowView = document.getElementById("linkedinFlowView");
const searchView = document.getElementById("searchView");
const changeProviderBtn = document.getElementById("changeProviderBtn");
const backToLinkedinFlowsBtn = document.getElementById("backToLinkedinFlowsBtn");
const backToLinkedinFlowsWorkBtn = document.getElementById("backToLinkedinFlowsWorkBtn");
const searchQueryInput = document.getElementById("searchQuery");
const searchTypeSelect = document.getElementById("searchType");
const searchBtn = document.getElementById("searchBtn");
const filterLocationInput = document.getElementById("filterLocation");
const filterIndustryInput = document.getElementById("filterIndustry");
const searchRunState = document.getElementById("searchRunState");
const searchRunTitle = document.getElementById("searchRunTitle");
const searchRunMeta = document.getElementById("searchRunMeta");
const searchJourney = document.getElementById("searchJourney");
const csvCard = document.getElementById("csvCard");
const importPanel = document.getElementById("importPanel");
const pickProviderHint = document.getElementById("pickProviderHint");
const modeToggle = document.getElementById("modeToggle");
const appTitleEl = document.getElementById("appTitle");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const sendBtn = document.getElementById("sendBtn");
const resultEl = document.getElementById("result");
const providerTag = document.getElementById("providerTag");
const unsupportedText = document.getElementById("unsupportedText");
const supportedProvidersEl = document.getElementById("supportedProviders");
const authTokenInput = document.getElementById("authToken");
const authApiBaseInput = document.getElementById("authApiBase");
const authErrorEl = document.getElementById("authError");
const connectBtn = document.getElementById("connectBtn");
const useProdApiBtn = document.getElementById("useProdApiBtn");
const workspaceNameEl = document.getElementById("workspaceName");
const disconnectBtn = document.getElementById("disconnectBtn");
const openLeadsBtn = document.getElementById("openLeadsBtn");
const authView = document.getElementById("authView");
const unsupportedView = document.getElementById("unsupportedView");
const appView = document.getElementById("appView");

let apiBase = DEFAULT_API_BASE;
let token = "";
let session = null;
let activeProvider = null;
let providerUI = null;
let userImportMode = "connections";

let leads = [];
let lastPageType = "other";
let importMode = "connections";
let phase = "idle";
let errorStepIndex = null;
let activeSteps = [];
let progressListenerAttached = false;

function normalizeApiBase(value) {
  return (value || DEFAULT_API_BASE).trim().replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function leadProfileUrl(lead) {
  return lead?.profile_url || lead?.linkedin_url || "";
}

function leadPreviewMeta(lead) {
  const name = String(lead?.name || "").trim().toLowerCase();
  const uniq = (value) => {
    const v = String(value || "").trim();
    if (!v) return "";
    if (name && v.toLowerCase() === name) return "";
    return v;
  };
  const role = [uniq(lead.title), uniq(lead.company), uniq(lead.location)].filter(Boolean);
  const contact = [lead.email, lead.phone, lead.website].filter(Boolean);
  const about = (lead.about || "").trim();
  if (contact.length > 0) {
    return [...role, contact.join(" · ")].filter(Boolean).join(" · ");
  }
  if (role.length > 0) return role.join(" · ");
  if (about) return about.slice(0, 80) + (about.length > 80 ? "…" : "");
  const headline = uniq(lead.headline);
  return headline || leadProfileUrl(lead);
}

function ensureProgressListener() {
  if (progressListenerAttached || !ext?.runtime?.onMessage) return;
  ext.runtime.onMessage.addListener(handleScrapeProgress);
  progressListenerAttached = true;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    ext.runtime.sendMessage(message, (response) => {
      const lastError = ext.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "background_unreachable"));
        return;
      }
      resolve(response);
    });
  });
}

async function tryRestoreScrapeState() {
  if (!activeProvider) return false;

  let state;
  try {
    state = await sendRuntimeMessage({ type: "get-scrape-state" });
  } catch {
    return false;
  }

  if (!state || state.providerId !== activeProvider.id) return false;

  if (state.status === "running") {
    phase = state.phase || "scanning";
    ensureProgressListener();
    setLiveProgress(true);
    if (state.progress) {
      handleScrapeProgress({ type: "scrape-progress", ...state.progress });
    } else {
      renderProgress();
      statusEl.textContent = "Tarama devam ediyor…";
    }
    sendBtn.disabled = true;
    void watchScrapeUntilDone();
    return true;
  }

  if (state.status === "ready" && Array.isArray(state.leads) && state.leads.length > 0) {
    leads = state.leads;
    phase = "ready";
    setLiveProgress(false);
    setActivityLine("");
    renderPreview();
    renderProgress();
    statusEl.textContent = `${leads.length} ${entityLabel()} ready to import`;
    return true;
  }

  if (state.status === "error") {
    phase = "error";
    statusEl.textContent = state.error || "Scan failed";
    renderProgress();
    return true;
  }

  return false;
}

async function watchScrapeUntilDone() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (phase === "ready" || phase === "done") return;

    let state;
    try {
      state = await sendRuntimeMessage({ type: "get-scrape-state" });
    } catch {
      return;
    }

    if (state.status === "ready" && Array.isArray(state.leads)) {
      leads = state.leads;
      setActivityLine("");
      setLiveProgress(false);
      renderPreview();
      return;
    }
    if (state.status === "error") {
      setLiveProgress(false);
      setError(0, state.error || "Scan failed");
      return;
    }
    if (state.status !== "running") return;
    if (state.progress) {
      handleScrapeProgress({ type: "scrape-progress", ...state.progress });
    }
  }
}

function setActivityLine(message) {
  if (!message) {
    activityLineEl.textContent = "";
    activityLineEl.classList.add("hidden");
    return;
  }
  activityLineEl.textContent = message;
  activityLineEl.classList.remove("hidden");
}

function setLiveProgress(active) {
  progressCard.classList.toggle("is-live", active);
}

function hideAllViews() {
  authView.classList.add("hidden");
  unsupportedView.classList.add("hidden");
  appView.classList.add("hidden");
}

function showAuth() {
  hideAllViews();
  authView.classList.remove("hidden");
  providerTag.textContent = cfg.brandTag || "Browser extension";
}

function applyBrandChrome() {
  const brandEls = document.querySelectorAll(".brand-name");
  brandEls.forEach((el) => {
    el.textContent = BRAND_NAME;
  });
  const brandTagEl = document.getElementById("providerTag");
  if (brandTagEl && !activeProvider) {
    brandTagEl.textContent = cfg.brandTag || "Browser Extension";
  }
  if (headerSub && !activeProvider) {
    headerSub.textContent = cfg.tagline || headerSub.textContent;
  }
  const titleEl = document.querySelector("title");
  if (titleEl) titleEl.textContent = BRAND_NAME;
  const tokenInput = authTokenInput;
  if (tokenInput) {
    tokenInput.placeholder = `${TOKEN_PREFIX}...`;
  }
  if (authApiBaseInput && !authApiBaseInput.value) {
    authApiBaseInput.placeholder = DEFAULT_API_BASE;
  }
  if (useProdApiBtn) {
    try {
      const host = new URL(PROD_API_BASE).host;
      useProdApiBtn.textContent = `API: ${host}`;
    } catch {
      useProdApiBtn.textContent = `API: ${PROD_API_BASE}`;
    }
  }
  document.documentElement.style.setProperty("--brand-primary", cfg.primaryColor || "#0B3A5B");
  document.documentElement.style.setProperty("--brand-accent", cfg.accentColor || "#1F7A8C");
}

function showAppShell(nextSession) {
  session = nextSession;
  workspaceNameEl.textContent = sessionWorkspaceName(nextSession) || BRAND_NAME;
  hideAllViews();
  appView.classList.remove("hidden");
  setProductScreen("providers");
  renderProviderPicker();
}

function setProductScreen(screen) {
  providerView?.classList.add("hidden");
  linkedinFlowView?.classList.add("hidden");
  searchView?.classList.add("hidden");
  importPanel.classList.add("hidden");
  pickProviderHint?.classList.add("hidden");
  document.querySelector(".wrap")?.classList.remove("is-searching");

  if (screen === "providers") providerView?.classList.remove("hidden");
  if (screen === "linkedin-actions") linkedinFlowView?.classList.remove("hidden");
  if (screen === "linkedin-search") {
    searchView?.classList.remove("hidden");
    importPanel.classList.remove("hidden");
    csvCard?.classList.add("hidden");
  }
  if (screen === "linkedin-work") {
    importPanel.classList.remove("hidden");
    csvCard?.classList.remove("hidden");
  }
}

function setSearchRun(active, title = "", meta = "") {
  document.querySelector(".wrap")?.classList.toggle("is-searching", active);
  searchRunState?.classList.toggle("hidden", !active && !title);
  if (searchRunTitle && title) searchRunTitle.textContent = title;
  if (searchRunMeta && meta) searchRunMeta.textContent = meta;
}

function setSearchJourney(stage) {
  if (!searchJourney) return;
  searchJourney.classList.remove("hidden");
  const order = ["search", "filters", "pages", "ready"];
  const idx = order.indexOf(stage);
  searchJourney.querySelectorAll("[data-search-stage]").forEach((li) => {
    const key = li.getAttribute("data-search-stage");
    const at = order.indexOf(key);
    li.classList.toggle("active", at === idx);
    li.classList.toggle("done", at >= 0 && at < idx);
  });
}

function showProviderPicker() {
  activeProvider = null;
  providerUI = null;
  providerTag.textContent = cfg.brandTag || "Browser Extension";
  setProductScreen("providers");
  renderProviderPicker();
}

function showProviderFlow(provider) {
  activeProvider = provider;
  providerUI = provider.ui;
  providerTag.textContent = provider.label;
  setProductScreen("linkedin-actions");
}

function showLinkedInSearch() {
  setProductScreen("linkedin-search");
  appTitleEl.classList.add("hidden");
  headerSub.classList.add("hidden");
  backToLinkedinFlowsWorkBtn?.classList.add("hidden");
  setupCard.classList.add("hidden");
  modeToggle.classList.add("hidden");
  phase = "idle";
  statusEl.textContent = "Search people or companies. We open LinkedIn and scan result pages.";
  renderProgress();
  searchQueryInput?.focus();
}

function showLinkedInWork(title, subtitle) {
  setProductScreen("linkedin-work");
  appTitleEl.textContent = title;
  headerSub.textContent = subtitle;
  appTitleEl.classList.remove("hidden");
  headerSub.classList.remove("hidden");
  backToLinkedinFlowsWorkBtn?.classList.remove("hidden");
  setupCard.classList.add("hidden");
  modeToggle.classList.add("hidden");
}

function resetFlowState() {
  leads = [];
  lastPageType = "other";
  phase = "idle";
  errorStepIndex = null;
  previewEl.innerHTML = "";
  resultEl.textContent = "";
  resultEl.className = "result";
  statusEl.textContent = "";
  sendBtn.disabled = true;
  setActivityLine("");
  setLiveProgress(false);
  setSearchRun(false);
}

async function runLinkedInFlow(flow) {
  resetFlowState();
  activeProvider = registry.getProvider("linkedin");
  providerUI = activeProvider?.ui || null;
  if (!activeProvider) return;

  if (flow === "search") {
    userImportMode = "search";
    importMode = "search";
    showLinkedInSearch();
    return;
  }

  if (flow === "connections") {
    userImportMode = "connections";
    importMode = "connections";
    showLinkedInWork("Import my connections", "We open your connections list, collect everyone, then enrich slowly.");
    setPhase("scanning");
    setActivityLine("Opening connections…");
    statusEl.textContent = "Preparing LinkedIn connections…";
    try {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      ensureProgressListener();
      await sendRuntimeMessage({ type: "clear-scrape-state" });
      const response = await sendRuntimeMessage({ type: "collect-linkedin-connections", tabId: tab?.id });
      if (response?.error) throw new Error(response.error);
      leads = response?.leads || [];
      lastPageType = "connections";
      setActivityLine("");
      setLiveProgress(false);
      setPhase("ready");
      renderPreview();
      statusEl.textContent = `${leads.length} connections ready`;
      void watchScrapeUntilDone();
    } catch (err) {
      statusEl.textContent = formatScrapeError(err);
      resultEl.textContent = err instanceof Error ? err.message : "";
      resultEl.classList.add("error");
      setError(0, "Scan failed");
      setLiveProgress(false);
    }
  }
}

async function searchLinkedInFromPopup() {
  const query = (searchQueryInput?.value || "").trim();
  if (!query) {
    searchQueryInput?.focus();
    return;
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  activeProvider = registry.getProvider("linkedin");
  providerUI = activeProvider?.ui || null;
  importMode = "search";
  userImportMode = "search";
  leads = [];
  lastPageType = "search";
  updateModeUI("https://www.linkedin.com/search/results/people/");
  setupCard.classList.add("hidden");
  ensureProgressListener();
  setPhase("scanning");
  setSearchJourney("search");
  setSearchRun(true, "Searching LinkedIn", `Query: “${query}”`);
  setActivityLine(`Searching “${query}”…`);
  statusEl.textContent = "Opening LinkedIn search…";
  previewEl.innerHTML = "";
  resultEl.textContent = "";
  sendBtn.disabled = true;
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching…";
  }

  const filters = {
    location: (filterLocationInput?.value || "").trim(),
    industry: (filterIndustryInput?.value || "").trim()
  };

  try {
    await sendRuntimeMessage({ type: "clear-scrape-state" });
    setSearchJourney(filters.location || filters.industry ? "filters" : "pages");
    const response = await sendRuntimeMessage({
      type: "search-linkedin",
      tabId: tab.id,
      query,
      searchType: searchTypeSelect?.value === "companies" ? "companies" : "people",
      maxPages: Math.min(40, Math.ceil((cfg.limits?.search || 800) / 10)),
      filters
    });
    if (response?.error) throw new Error(response.error);
    leads = response?.leads || [];
    lastPageType = "search";
    setSearchJourney("ready");
    setSearchRun(true, "Search complete", `${leads.length} unique results`);
    setActivityLine("");
    setLiveProgress(false);
    setPhase("ready");
    renderPreview();
    sendBtn.textContent = `Save to ${BRAND_NAME}`;
    void watchScrapeUntilDone();
  } catch (err) {
    leads = [];
    setActivityLine("");
    setLiveProgress(false);
    setSearchRun(false);
    statusEl.textContent = formatScrapeError(err);
    resultEl.textContent = err instanceof Error ? err.message : "Search failed";
    resultEl.className = "result error";
    setError(0, "Search failed");
  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search LinkedIn";
    }
  }
}

function setAuthError(message) {
  if (!message) {
    authErrorEl.textContent = "";
    authErrorEl.classList.add("hidden");
    return;
  }
  authErrorEl.textContent = message;
  authErrorEl.classList.remove("hidden");
}

function renderProviderPicker() {
  providerOptionsEl.innerHTML = registry
    .listAllProviders()
    .map((provider) => {
      const active = activeProvider?.id === provider.id;
      const disabled = !provider.enabled;
      return `<button
        type="button"
        class="provider-option${active ? " active" : ""}"
        data-provider-id="${provider.id}"
        ${disabled ? "disabled" : ""}
      >
        <span class="provider-option-name">${escapeHtml(provider.label)}</span>
        <span class="provider-option-desc">${escapeHtml(provider.pickerDescription || "")}</span>
        ${disabled ? '<span class="provider-option-badge">Coming soon</span>' : ""}
      </button>`;
    })
    .join("");
}

async function loadSettings() {
  const keys = [
    storageKey("apiBase"),
    storageKey("token"),
    storageKey("workspaceName"),
    storageKey("selectedProviderId"),
    storageKey("importModeByProvider"),
    // legacy unprefixed keys (short migration window)
    "apiBase",
    "token",
    "organizationName",
    "workspaceName",
    "selectedProviderId",
    "importModeByProvider"
  ];
  const stored = await ext.storage.sync.get(keys);
  apiBase = normalizeApiBase(stored[storageKey("apiBase")] || stored.apiBase || DEFAULT_API_BASE);
  token = (stored[storageKey("token")] || stored.token || "").trim();
  authApiBaseInput.value = apiBase;
  authTokenInput.value = token;
  const workspace =
    stored[storageKey("workspaceName")] || stored.workspaceName || stored.organizationName;
  if (workspace) {
    workspaceNameEl.textContent = workspace;
  }
}

async function saveSettings(nextSession) {
  const name = sessionWorkspaceName(nextSession) || sessionWorkspaceName(session) || "";
  const features = nextSession?.features || session?.features || null;
  await ext.storage.sync.set({
    [storageKey("apiBase")]: apiBase,
    [storageKey("token")]: token,
    [storageKey("workspaceName")]: name,
    [storageKey("features")]: features || {}
  });
}

function runtimeFeatures() {
  const resolve = globalThis.liImportResolveFeatures;
  if (typeof resolve === "function") return resolve(cfg, session?.features || null);
  return registry.resolveFeatures?.(session?.features) || { aiEnabled: false, enrichEnabled: false };
}

function providerForUi(provider) {
  if (!provider) return null;
  return registry.withRuntimeFeatures?.(provider, session?.features) || provider;
}

async function saveProviderSelection() {
  const key = storageKey("importModeByProvider");
  const stored = await ext.storage.sync.get([key, "importModeByProvider"]);
  const modes = stored[key] || stored.importModeByProvider || {};
  if (activeProvider) {
    modes[activeProvider.id] = userImportMode;
  }
  await ext.storage.sync.set({
    [storageKey("selectedProviderId")]: activeProvider?.id || "",
    [key]: modes
  });
}

async function validateSession(base, secret) {
  const normalizedBase = normalizeApiBase(base);
  const normalizedToken = secret.trim();
  if (!normalizedToken) {
    throw new Error("token_required");
  }

  let res;
  try {
    res = await fetch(`${normalizedBase}/v1/session`, {
      headers: { Authorization: `Bearer ${normalizedToken}` }
    });
  } catch {
    throw new Error("network");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "unauthorized");
  }
  return body;
}

function authErrorMessage(code) {
  if (code === "token_required") return "Extension token gerekli.";
  if (code === "network") return AUTH_ERRORS.network;
  return AUTH_ERRORS[code] || AUTH_ERRORS.unauthorized;
}

async function connect() {
  setAuthError("");
  const nextToken = authTokenInput.value.trim();
  const nextBase = normalizeApiBase(authApiBaseInput.value);

  if (!nextToken.startsWith(TOKEN_PREFIX)) {
    setAuthError(`Token must start with ${TOKEN_PREFIX}.`);
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = "Verifying…";

  try {
    const nextSession = await validateSession(nextBase, nextToken);
    apiBase = nextBase;
    token = nextToken;
    await saveSettings(nextSession);
    await initApp(nextSession);
  } catch (err) {
    const code = err instanceof Error ? err.message : "unauthorized";
    setAuthError(authErrorMessage(code));
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }
}

async function disconnect() {
  token = "";
  session = null;
  activeProvider = null;
  providerUI = null;
  leads = [];
  phase = "idle";
  try {
    await sendRuntimeMessage({ type: "clear-scrape-state" });
  } catch {
    // ignore
  }
  await ext.storage.sync.set({
    [storageKey("token")]: "",
    [storageKey("workspaceName")]: "",
    [storageKey("selectedProviderId")]: ""
  });
  authTokenInput.value = "";
  setAuthError("");
  showAuth();
}

async function openSavedLeadsPage() {
  const url = ext.runtime.getURL("leads.html");
  await ext.tabs.create({ url });
}

function supportsModeToggle(provider) {
  return Boolean(provider?.importModes?.includes("connections") || provider?.importModes?.includes("search"));
}

function supportsConnectionsMode(provider) {
  return provider?.importModes?.includes("connections");
}

function supportsSearchMode(provider) {
  return provider?.importModes?.includes("search");
}

function isOnEntryPage(provider, url) {
  return provider?.detectImportMode?.(url) === "connections";
}

function isOnSearchPage(provider, url) {
  return provider?.detectImportMode?.(url) === "search";
}

function isScrollMode(mode) {
  return mode === "connections" || mode === "search";
}

function resolveImportMode(provider, url, userMode) {
  const detected = provider?.detectImportMode?.(url) || "quick";
  if (detected === "search" && supportsSearchMode(provider)) return "search";
  if (userMode === "search" && supportsSearchMode(provider)) return "search";
  if (userMode === "connections" && supportsConnectionsMode(provider)) return "connections";
  if (provider?.importModes?.includes(userMode)) return userMode;
  return "quick";
}

function phaseCopy() {
  if (!providerUI?.phase) return "Initializing…";
  if (phase === "idle") return providerUI.phase.idle || "Scan to start";
  if (phase === "parsing") return providerUI.phase.parsing || "Reading details…";
  if (phase === "enriching") return providerUI.phase.enriching || providerUI.phase.parsing || "Reading details…";
  if (phase === "scanning") {
    if (importMode === "connections") return providerUI.phase.scanning || "Listing connections…";
    if (importMode === "search") return providerUI.phase.scanningSearch || "Listing search results…";
    return providerUI.phase.scanningQuick || "Scanning page…";
  }
  return providerUI.phase[phase] || "";
}

function stepState(index) {
  if (phase === "done") return "done";
  if (phase === "error") {
    if (errorStepIndex !== null && index === errorStepIndex) return "error";
    if (errorStepIndex !== null && index < errorStepIndex) return "done";
    return "idle";
  }

  const activeKey =
    phase === "scanning"
      ? isScrollMode(importMode)
        ? "scroll"
        : "scan"
      : phase === "parsing"
        ? "parse"
        : phase === "enriching"
          ? "enrich"
          : phase === "ready"
            ? "ready"
            : phase === "sending"
              ? "send"
              : "";
  const activeIndex = activeKey ? activeSteps.findIndex((step) => step.key === activeKey) : -1;

  if (activeIndex < 0) return "idle";
  if (index < activeIndex) return "done";
  if (index === activeIndex) return "active";
  return "idle";
}

function stepIndexForKey(key, fallbackIndex) {
  const index = activeSteps.findIndex((step) => step.key === key);
  return index >= 0 ? index : fallbackIndex;
}

function progressPercent() {
  switch (phase) {
    case "scanning":
      return 20;
    case "parsing":
      return 45;
    case "enriching":
      return 62;
    case "ready":
      return 72;
    case "sending":
      return 88;
    case "done":
      return 100;
    case "error":
      return 88;
    default:
      return 6;
  }
}

function renderProgress() {
  phaseTitleEl.textContent = phaseCopy();
  progressFillEl.style.width = `${progressPercent()}%`;
  rescanBtn.hidden = phase === "scanning" || phase === "parsing" || phase === "enriching" || phase === "sending";
  if (cancelBtn) {
    cancelBtn.hidden = !(phase === "scanning" || phase === "parsing" || phase === "enriching");
  }
  setLiveProgress(phase === "scanning" || phase === "parsing" || phase === "enriching");

  stepsEl.innerHTML = activeSteps
    .map((step, index) => {
      const state = stepState(index);
      const icon = state === "done" ? "✓" : state === "error" ? "!" : "";
      return `<li class="step ${state}"><span class="step-icon">${icon}</span><span>${step.label}</span></li>`;
    })
    .join("");
}

function setPhase(next) {
  phase = next;
  if (next !== "error") errorStepIndex = null;
  renderProgress();
}

function setError(stepIndex, title) {
  errorStepIndex = stepIndex;
  phase = "error";
  phaseTitleEl.textContent = title;
  renderProgress();
}

function renderModeToggle() {
  const showToggle = supportsModeToggle(activeProvider);
  modeToggle.classList.toggle("hidden", !showToggle);
  modeToggle.querySelectorAll(".mode-btn").forEach((button) => {
    const mode = button.getAttribute("data-mode");
    const allowed = !mode || activeProvider?.importModes?.includes(mode);
    button.hidden = !allowed;
    button.classList.toggle("active", mode === importMode);
  });
}

function updateModeUI(url) {
  if (!activeProvider || !providerUI) return;

  importMode = resolveImportMode(activeProvider, url, userImportMode);
  const onEntryPage = isOnEntryPage(activeProvider, url);
  const onSearchPage = isOnSearchPage(activeProvider, url);

  if (importMode === "search" && providerUI.stepsSearch) {
    activeSteps = providerUI.stepsSearch;
  } else if (importMode === "connections" && providerUI.stepsConnections) {
    activeSteps = providerUI.stepsConnections;
  } else {
    activeSteps = providerUI.stepsQuick || [];
  }

  const showConnectionsSetup = importMode === "connections" && !onEntryPage;
  const showSearchSetup = importMode === "search" && !onSearchPage;
  setupCard.classList.toggle("hidden", !(showConnectionsSetup || showSearchSetup));
  appTitleEl.textContent = providerUI.importTitle || activeProvider.label;

  if (importMode === "search") {
    setupTitleEl.textContent = providerUI.setupTitleSearch || "Run a LinkedIn search";
    setupTextEl.textContent = providerUI.setupTextSearch || "";
    openEntryBtn.textContent = providerUI.openSearchLabel || "Open LinkedIn search";
    headerSub.textContent = providerUI.importSubtitleSearch || "";
    sendBtn.textContent = providerUI.sendSearch || providerUI.sendQuick;
  } else if (importMode === "connections") {
    setupTitleEl.textContent = providerUI.setupTitle || "";
    setupTextEl.textContent = providerUI.setupText || "";
    openEntryBtn.textContent = providerUI.openEntryLabel || "Open page";
    headerSub.textContent = providerUI.importSubtitleConnections || "";
    sendBtn.textContent = providerUI.sendConnections || providerUI.sendQuick;
  } else {
    setupTitleEl.textContent = providerUI.setupTitle || "";
    setupTextEl.textContent = providerUI.setupText || "";
    openEntryBtn.textContent = providerUI.openEntryLabel || "Open page";
    headerSub.textContent = providerUI.importSubtitleQuick || "";
    sendBtn.textContent = providerUI.sendQuick;
  }

  renderModeToggle();
}

function entityLabel() {
  if (!providerUI) return "record";
  if (importMode === "connections" || lastPageType === "connections") {
    return providerUI.entityConnections || "record";
  }
  if (importMode === "search" || lastPageType === "search") {
    return providerUI.entitySearch || "result";
  }
  return providerUI.entityQuick || "profile";
}

function renderPreview() {
  previewEl.innerHTML = "";
  resultEl.textContent = "";
  resultEl.className = "result";

  if (leads.length === 0) {
    let hint = "No profiles found on this page. Try another page.";
    if (importMode === "connections") {
      hint =
        lastPageType === "connections"
          ? "No records found. Make sure the list is loaded and press Rescan."
          : "Go to the Connections page or use the button below.";
    } else if (importMode === "search") {
      hint =
        lastPageType === "search"
          ? "No results found. Scroll the page a bit, then press Rescan."
          : "Search on LinkedIn (e.g. tmgdk), stay on results, then scan.";
    }
    statusEl.textContent = hint;
    sendBtn.disabled = true;
    setError(1, "No records found");
    return;
  }

  statusEl.textContent = `${leads.length} ${entityLabel()} found`;
  sendBtn.disabled = false;
  setPhase("ready");

  leads.slice(0, 6).forEach((lead) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(lead.name)}</strong><span class="lead-meta">${escapeHtml(leadPreviewMeta(lead))}</span>`;
    previewEl.appendChild(li);
  });
  if (leads.length > 6) {
    const more = document.createElement("li");
    more.innerHTML = `<small>+${leads.length - 6} more…</small>`;
    previewEl.appendChild(more);
  }
}

function formatScrapeError(err, fallback) {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "cancelled") {
    return "Scan cancelled.";
  }
  if (message === "enrich_aborted_errors") {
    return "Enrich stopped after repeated errors (ban-safe). Listed leads are saved; try again later.";
  }
  if (message === "scripting_api_unavailable") {
    return `Extension is out of date. Go to chrome://extensions → ${BRAND_NAME} → Reload.`;
  }
  if (message === "unsupported_provider") {
    return "This provider is not active yet.";
  }
  if (message === "login_required") {
    return providerUI?.loginRequired || "Sign in to LinkedIn in this tab, then try again.";
  }
  if (message === "challenge_required") {
    return providerUI?.challengeRequired || "Complete the LinkedIn security check, then rescan.";
  }
  if (message === "search_empty") {
    return providerUI?.searchEmpty || "No search results on this page.";
  }
  if (message === "no_leads_found") {
    return providerUI?.noLeadsFound || "No importable profiles found on this page.";
  }
  if (message === "content_script_missing" || fallback === "content_script_missing") {
    return `Refresh the ${activeProvider?.label || "page"} tab (F5), then try again.`;
  }
  if (/cannot access|Cannot access/i.test(message)) {
    return "Could not access tab. Refresh the page.";
  }
  return message || "Scan failed";
}

function renderLivePreview(sample) {
  if (!Array.isArray(sample) || sample.length === 0) return;
  previewEl.innerHTML = "";
  sample.forEach((lead) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(lead.name || "—")}</strong><span class="lead-meta">${escapeHtml(leadPreviewMeta(lead))}</span>`;
    previewEl.appendChild(li);
  });
}

function handleScrapeProgress(message) {
  if (message?.type !== "scrape-progress") return;

  if (message.phase === "done") {
    void sendRuntimeMessage({ type: "get-scrape-state" }).then((state) => {
      if (state && state.status === "ready") {
        leads = state.leads;
        phase = "ready";
        setLiveProgress(false);
        setActivityLine("");
        renderPreview();
        renderProgress();
        statusEl.textContent = `${leads.length} ${entityLabel()} ready to import`;
      }
    });
    return;
  }

  if (message.phase === "error") {
    setLiveProgress(false);
    setError(stepIndexForKey("scroll", 0), message.error || "Scan failed");
    statusEl.textContent = message.error || "Scan failed";
    return;
  }

  if (phase === "idle" || phase === "ready" || phase === "done" || phase === "error") {
    if (message.providerId && (!activeProvider || activeProvider.id !== message.providerId)) {
      const provider = registry.getProvider(message.providerId);
      if (provider?.enabled) {
        const screen = message.mode === "search" || userImportMode === "search" ? "linkedin-search" : "linkedin-work";
        activateProvider(provider, { persist: false, resetLeads: false, screen });
      }
    }
    phase = message.stage === "scroll" ? "scanning" : message.stage === "parse" ? "parsing" : "enriching";
    setLiveProgress(true);
  }

  if (message.stage === "filter") {
    setSearchJourney("filters");
    setSearchRun(true, "Applying filters", message.message || "");
    setActivityLine(message.message || "Applying LinkedIn filters…");
  } else if (message.stage === "scroll") {
    phase = "scanning";
    const entity = importMode === "search" || userImportMode === "search" ? "results" : "connections";
    if (importMode === "search" || userImportMode === "search") {
      setSearchJourney("pages");
      setSearchRun(
        true,
        "Scanning result pages",
        message.message || `${message.found || 0} unique · page ${message.page || "?"}`
      );
    }
    setActivityLine(message.message || `${message.found || 0} ${entity} found`);
    if (message.found) {
      statusEl.textContent = `${message.found} ${entity} listed`;
    }
    if (message.sample) renderLivePreview(message.sample);
  } else if (message.stage === "parse") {
    phase = "parsing";
    setActivityLine(message.message || "Reading title and company information…");
    statusEl.textContent = `${message.found || 0} processing`;
    if (message.sample) renderLivePreview(message.sample);
  } else if (message.stage === "enrich") {
    if (message.phase === "done") {
      phase = "enriching";
      setActivityLine(message.message || "Profile enrich finished");
      if (importMode === "search" || userImportMode === "search") {
        setSearchJourney("ready");
        setSearchRun(true, "Enrich finished", message.message || "");
      }
      const enriched = message.enriched ?? 0;
      const listed = message.found ?? 0;
      const deferred = message.deferred ?? 0;
      statusEl.textContent = deferred
        ? `${enriched} enriched · ${listed} listed · ${deferred} deferred (session/daily cap)`
        : `${enriched} enriched · ${listed} listed`;
      renderProgress();
      return;
    }

    phase = "enriching";
    const profileTotal = message.total || message.enriched || "?";
    const profileIndex = message.index || 0;
    if (importMode === "search" || userImportMode === "search") {
      setSearchRun(
        true,
        "Enriching profiles",
        message.message || `${profileIndex}/${profileTotal}`
      );
    }
    setActivityLine(
      message.message ||
        (message.name ? `Reading ${message.name}…` : `Reading ${profileIndex}/${profileTotal} profile…`)
    );
    statusEl.textContent = message.name
      ? `${message.name} — ${profileIndex}/${profileTotal}`
      : `Enrich ${profileIndex}/${profileTotal}`;
    if (message.detail || message.sample) {
      const previewLead = message.sample?.[0] || {
        name: message.name,
        title: message.detail,
        email: message.detail?.includes("@") ? message.detail.split(" · ")[0] : undefined
      };
      renderLivePreview(message.sample || [previewLead]);
    }
  }

  renderProgress();
}

function scrapeProviderTab(tabId, providerId, mode) {
  ensureProgressListener();
  return new Promise((resolve, reject) => {
    if (!ext?.runtime?.sendMessage) {
      reject(new Error("extension_runtime_unavailable"));
      return;
    }

    ext.runtime.sendMessage({ type: "scrape-provider-tab", tabId, providerId, mode }, (response) => {
      const lastError = ext.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "background_unreachable"));
        return;
      }
      if (!response) {
        reject(new Error("background_empty_response"));
        return;
      }
      if (response.error) {
        const err = new Error(response.error);
        if (response.fallback) err.fallback = response.fallback;
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

async function collectFromActiveTab() {
  if (!activeProvider) return;

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  updateModeUI(tab?.url || "");

  if (!tab?.id || !activeProvider.hostPattern.test(tab.url || "")) {
    phase = "idle";
    statusEl.textContent = providerUI.notOnProvider || `You are not on the ${activeProvider.label} page.`;
    renderProgress();
    return;
  }

  const onEntryPage = isOnEntryPage(activeProvider, tab.url || "");
  const onSearchPage = isOnSearchPage(activeProvider, tab.url || "");
  if (importMode === "connections" && !onEntryPage) {
    phase = "idle";
    statusEl.textContent = providerUI.setupText || "Go to the Connections page.";
    renderProgress();
    return;
  }
  if (importMode === "search" && !onSearchPage) {
    phase = "idle";
    statusEl.textContent = providerUI.setupTextSearch || "Run a LinkedIn search first.";
    renderProgress();
    return;
  }

  setPhase("scanning");
  setActivityLine(
    importMode === "connections"
      ? "Scrolling list…"
      : importMode === "search"
        ? "Scrolling search results…"
        : "Reading page…"
  );
  statusEl.textContent =
    importMode === "connections"
      ? providerUI.scanningConnections || "Scanning list…"
      : importMode === "search"
        ? providerUI.scanningSearch || "Scanning search results…"
        : providerUI.scanningQuick || "Scanning page…";
  sendBtn.disabled = true;
  previewEl.innerHTML = "";
  resultEl.textContent = "";
  resultEl.className = "result";

  try {
    await sendRuntimeMessage({ type: "clear-scrape-state" });
  } catch {
    // ignore
  }

  try {
    const mode = isScrollMode(importMode) ? importMode : "quick";
    const response = await scrapeProviderTab(tab.id, activeProvider.id, mode);
    leads = response?.leads || [];
    lastPageType =
      response?.page_type ||
      (onEntryPage ? "connections" : onSearchPage ? "search" : "other");
    setActivityLine("");
    setLiveProgress(false);
    setPhase("ready");
    renderPreview();
  } catch (err) {
    statusEl.textContent = formatScrapeError(err, err?.fallback);
    resultEl.textContent = err instanceof Error ? err.message : "";
    resultEl.classList.add("error");
    leads = [];
    setActivityLine("");
    setLiveProgress(false);
    setError(0, "Scan failed");
  }
}

async function openEntryPage() {
  if (!activeProvider) return;
  const targetUrl =
    importMode === "search"
      ? activeProvider.searchEntryUrl || "https://www.linkedin.com/search/results/all/"
      : activeProvider.entryUrl;
  if (!targetUrl) return;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (!activeProvider.hostPattern.test(tab.url || "")) {
    await ext.tabs.create({ url: targetUrl });
    return;
  }
  await ext.tabs.update(tab.id, { url: targetUrl });
  statusEl.textContent = "Opening page… reopen the extension once it's loaded.";
}

function normalizeLeadsForApi(rawLeads) {
  return rawLeads.map((lead) => {
    const title = (lead.title || lead.headline || "").trim();
    const company = (lead.company || "").trim();
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
      about: lead.about || undefined
    };
  });
}

async function sendLeads() {
  resultEl.textContent = "";
  resultEl.className = "result";

  if (!token || !activeProvider) {
    resultEl.textContent = "Session expired. Please reconnect.";
    resultEl.classList.add("error");
    await disconnect();
    return;
  }
  if (leads.length === 0) {
    resultEl.textContent = "No records to import.";
    resultEl.classList.add("error");
    return;
  }

  setPhase("sending");
  sendBtn.disabled = true;
  sendBtn.textContent = "Importing…";

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const payloadLeads = normalizeLeadsForApi(leads);
  let created = 0;
  let merged = 0;
  let skipped = 0;

  try {
    for (let offset = 0; offset < payloadLeads.length; offset += BATCH_SIZE) {
      const chunk = payloadLeads.slice(offset, offset + BATCH_SIZE);
      const end = Math.min(offset + BATCH_SIZE, payloadLeads.length);
      statusEl.textContent = `Importing to ${BRAND_NAME} ${offset + 1}–${end} / ${payloadLeads.length}…`;

      const res = await fetch(`${apiBase}/v1/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: activeProvider.id,
          leads: chunk,
          page_url: tab?.url
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        resultEl.textContent = "Token is invalid. Please reconnect.";
        resultEl.classList.add("error");
        await disconnect();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      created += body.created ?? 0;
      merged += body.merged ?? 0;
      skipped += body.skipped ?? 0;
    }

    setPhase("done");
    statusEl.textContent = providerUI.phase?.done || "Import completed";
    const queued = created + merged;
    resultEl.innerHTML = [
      `<strong>${created}</strong> new · <strong>${merged}</strong> updated · <strong>${skipped}</strong> skipped`,
      `<br><button type="button" class="text-btn" id="viewSavedLeadsBtn">Open saved leads list →</button>`,
      queued > 0
        ? `<br><span class="muted">Saved as Waiting → then Queued → In progress → Done. Open the list to watch each row.</span>`
        : ""
    ].join("");
    document.getElementById("viewSavedLeadsBtn")?.addEventListener("click", () => void openSavedLeadsPage());
  } catch (err) {
    setError(stepIndexForKey("send", 2), "Import failed");
    statusEl.textContent = "Import failed";
    const msg = err instanceof Error ? err.message : "Import failed";
    if (msg === "Failed to fetch" || /network/i.test(msg)) {
      resultEl.textContent = AUTH_ERRORS.network;
    } else {
      resultEl.textContent = msg;
    }
    resultEl.classList.add("error");
  } finally {
    sendBtn.disabled = leads.length === 0;
    sendBtn.textContent =
      importMode === "connections"
        ? providerUI.sendConnections || providerUI.sendQuick
        : importMode === "search"
          ? providerUI.sendSearch || providerUI.sendQuick
          : providerUI.sendQuick;
    renderProgress();
  }
}

function activateProvider(provider, { persist = true, resetLeads = true, screen = "linkedin-work" } = {}) {
  if (!provider?.enabled) return;

  const runtime = providerForUi(provider);
  activeProvider = runtime;
  providerUI = runtime.ui;
  providerTag.textContent = runtime.label;
  userImportMode = userImportMode || runtime.defaultImportMode || "quick";

  if (resetLeads) {
    leads = [];
    lastPageType = "other";
    phase = "idle";
    errorStepIndex = null;
    previewEl.innerHTML = "";
    resultEl.textContent = "";
    resultEl.className = "result";
  }

  if (runtime.id === "linkedin" && screen === "linkedin-actions") {
    showProviderFlow(runtime);
  } else if (runtime.id === "linkedin" && userImportMode === "search" && screen === "linkedin-search") {
    showLinkedInSearch();
  } else if (runtime.id === "linkedin") {
    const features = runtimeFeatures();
    const titles = {
      search: [
        "Find new leads",
        features.enrichEnabled
          ? "We save the list first (Waiting). Detail visits run later in the queue."
          : "List-only import (no AI provider — enrich skipped)."
      ],
      connections: [
        "Import my connections",
        features.enrichEnabled
          ? "Connections are saved first, then detail enrich runs in ban-safe batches."
          : "Connections list only (no AI provider — enrich skipped)."
      ],
      quick: ["This page", "Import profiles visible on the current LinkedIn page."]
    };
    const [title, sub] = titles[userImportMode] || titles.quick;
    showLinkedInWork(title, sub);
  } else {
    setProductScreen("linkedin-work");
    importPanel.classList.remove("hidden");
    appTitleEl.classList.remove("hidden");
    headerSub.classList.remove("hidden");
  }

  renderProviderPicker();
  renderModeToggle();
  void ext.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    updateModeUI(tab?.url || "");
  });

  if (persist) {
    void saveProviderSelection();
  }
}

async function selectProvider(providerId) {
  const provider = registry.getProvider(providerId);
  if (!provider) return;
  if (!provider.enabled) return;

  userImportMode = provider.defaultImportMode || "search";
  await saveProviderSelection();
  if (provider.id === "linkedin") {
    showProviderFlow(provider);
    return;
  }
  activateProvider(provider, { screen: "linkedin-work" });
  await initImportFlow({ autoScan: false });
}

async function setImportMode(mode) {
  if (!supportsModeToggle(activeProvider)) return;
  if (!activeProvider?.importModes?.includes(mode)) return;
  userImportMode = mode;
  leads = [];
  phase = "idle";
  await saveProviderSelection();
  await initImportFlow({ autoScan: false });
}

async function initImportFlow({ autoScan }) {
  if (!activeProvider || !session) return;

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  updateModeUI(tab?.url || "");

  const onEntryPage = isOnEntryPage(activeProvider, tab?.url || "");
  const onSearchPage = isOnSearchPage(activeProvider, tab?.url || "");
  const onProviderSite = activeProvider.hostPattern.test(tab?.url || "");

  if (autoScan && onProviderSite) {
    if (importMode === "connections" && onEntryPage) {
      await collectFromActiveTab();
      return;
    }
    if (importMode === "search" && onSearchPage) {
      await collectFromActiveTab();
      return;
    }
    if (importMode === "quick") {
      await collectFromActiveTab();
      return;
    }
  }

  phase = "idle";
  if (importMode === "connections" && !onEntryPage) {
    statusEl.textContent = providerUI.setupText || "Go to the Connections page.";
  } else if (importMode === "search" && !onSearchPage) {
    statusEl.textContent = providerUI.setupTextSearch || "Run a LinkedIn search first.";
  } else if (!onProviderSite) {
    statusEl.textContent = providerUI.notOnProvider || `Open ${activeProvider.label} page.`;
  } else {
    statusEl.textContent = providerUI.idleHint || "Press Rescan.";
  }
  renderProgress();
}

async function initApp(nextSession) {
  showAppShell(nextSession);

  try {
    await sendRuntimeMessage({ type: "ensure-bg-enrich" });
  } catch {
    // ignore
  }

  let state = null;
  try {
    state = await sendRuntimeMessage({ type: "get-scrape-state" });
  } catch (e) {
    // ignore
  }

  if (state && (state.status === "running" || state.status === "ready" || state.status === "error") && state.providerId) {
    const provider = registry.getProvider(state.providerId);
    if (provider?.enabled) {
      const stored = await ext.storage.sync.get([
        storageKey("importModeByProvider"),
        "importModeByProvider"
      ]);
      const modes = stored[storageKey("importModeByProvider")] || stored.importModeByProvider || {};
      userImportMode = state.mode || modes[provider.id] || provider.defaultImportMode || "search";
      const screen = userImportMode === "search" ? "linkedin-search" : "linkedin-work";
      activateProvider(provider, { persist: false, resetLeads: false, screen });
      await tryRestoreScrapeState();
      return;
    }
  }

  showProviderPicker();
}

async function boot() {
  applyBrandChrome();
  await loadSettings();

  if (!token) {
    showAuth();
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = "Verifying…";

  try {
    const nextSession = await validateSession(apiBase, token);
    await saveSettings(nextSession);
    await initApp(nextSession);
  } catch (err) {
    showAuth();
    const code = err instanceof Error ? err.message : "";
    setAuthError(code === "network" ? AUTH_ERRORS.network : "Saved token is invalid. Please enter a new token.");
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }
}

connectBtn.addEventListener("click", () => void connect());
disconnectBtn.addEventListener("click", () => void disconnect());
openLeadsBtn?.addEventListener("click", () => void openSavedLeadsPage());
useProdApiBtn.addEventListener("click", () => {
  authApiBaseInput.value = PROD_API_BASE;
});
authTokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void connect();
});
providerOptionsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-provider-id]");
  if (!button || button.disabled) return;
  void selectProvider(button.getAttribute("data-provider-id"));
});
linkedinFlowView?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-linkedin-flow]");
  if (!button) return;
  void runLinkedInFlow(button.getAttribute("data-linkedin-flow"));
});
changeProviderBtn?.addEventListener("click", () => {
  resetFlowState();
  showProviderPicker();
});
backToLinkedinFlowsBtn?.addEventListener("click", () => {
  resetFlowState();
  showProviderFlow(registry.getProvider("linkedin"));
});
backToLinkedinFlowsWorkBtn?.addEventListener("click", () => {
  resetFlowState();
  showProviderFlow(registry.getProvider("linkedin"));
});
searchBtn?.addEventListener("click", () => void searchLinkedInFromPopup());
searchQueryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void searchLinkedInFromPopup();
  }
});
modeToggle.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  void setImportMode(button.getAttribute("data-mode"));
});
async function importConnectionsCSV(file) {
  if (!activeProvider || activeProvider.id !== "linkedin") {
    statusEl.textContent = "CSV import is available for LinkedIn.";
    return;
  }
  const parser = globalThis.LiImportLinkedInCSV?.parseLinkedInConnectionsCSV;
  if (typeof parser !== "function") {
    statusEl.textContent = "CSV parser missing. Reload the extension.";
    return;
  }

  setPhase("scanning");
  setActivityLine("Reading Connections.csv…");
  statusEl.textContent = "Parsing LinkedIn export…";
  sendBtn.disabled = true;
  previewEl.innerHTML = "";
  resultEl.textContent = "";

  try {
    const text = await file.text();
    const parsed = parser(text, cfg.limits?.connections || 2500);
    if (parsed.error || !parsed.leads?.length) {
      throw new Error(parsed.error || "csv_no_rows");
    }
    leads = parsed.leads;
    lastPageType = "connections";
    importMode = "connections";
    setActivityLine("");
    setLiveProgress(false);
    setPhase("ready");
    renderPreview();
    statusEl.textContent = `${leads.length} connections loaded from CSV`;
  } catch (err) {
    const code = err instanceof Error ? err.message : "csv_failed";
    const messages = {
      csv_empty: "CSV file is empty.",
      csv_not_linkedin_connections: "Not a LinkedIn Connections.csv export. Use Data export → Connections.",
      csv_no_rows: "No profile rows found in this CSV."
    };
    statusEl.textContent = messages[code] || code;
    resultEl.textContent = statusEl.textContent;
    resultEl.classList.add("error");
    leads = [];
    setActivityLine("");
    setLiveProgress(false);
    setError(0, "CSV import failed");
  }
}

async function cancelScrape() {
  try {
    await sendRuntimeMessage({ type: "cancel-scrape" });
  } catch {
    // ignore
  }
  setLiveProgress(false);
  setActivityLine("");
  setError(0, "Scan cancelled");
  statusEl.textContent = "Scan cancelled";
  sendBtn.disabled = leads.length === 0;
}

sendBtn.addEventListener("click", () => void sendLeads());
rescanBtn.addEventListener("click", () => void collectFromActiveTab());
cancelBtn?.addEventListener("click", () => void cancelScrape());
openEntryBtn.addEventListener("click", () => void openEntryPage());
csvImportBtn?.addEventListener("click", () => csvFileInput?.click());
csvFileInput?.addEventListener("change", () => {
  const file = csvFileInput.files?.[0];
  if (file) void importConnectionsCSV(file);
  csvFileInput.value = "";
});

void boot();
