(function initLiImportContentBridge() {
  const ext = globalThis.chrome ?? globalThis.browser;
  const cfg = globalThis.LI_IMPORT_CONFIG || {};
  const BRAND_NAME = cfg.brandName || "Dgmos";
  const t = globalThis.DgmosI18n?.t || ((text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text));
  const BRAND_TAG = cfg.brandTag || "Lead Capture";
  const BRAND_INITIAL = (BRAND_NAME.trim()[0] || "L").toUpperCase();
  const BRAND_MARK_URL = ext?.runtime?.getURL ? ext.runtime.getURL("icons/icon48.png") : "";
  const BRAND_MARK = BRAND_MARK_URL ? `<img src="${BRAND_MARK_URL}" alt="" />` : BRAND_INITIAL;
  const PANEL_HOST_ID = cfg.panelHostId || "dgmos-linkedin-panel-host";
  const STORAGE_PREFIX = cfg.storagePrefix || "dgmos_";
  const PANEL_SEEN_KEY = `${STORAGE_PREFIX}panelSeen`;
  const WORKSPACE_KEY = `${STORAGE_PREFIX}workspaceName`;

  const state = {
    open: false,
    tutorialSeen: true,
    token: "",
    workspaceName: "",
    pageMode: "quick",
    phase: "idle",
    status: "",
    result: "",
    leads: [],
    sample: [],
    scanning: false,
    sending: false
  };

  let shadow = null;
  let els = {};
  let lastUrl = location.href;

  function resolveProvider() {
    const registry = globalThis.liImportProviderRegistry;
    return registry?.detectProvider(location.href) || null;
  }

  function resolveCollector() {
    const provider = resolveProvider();
    if (!provider) {
      return { provider: null, collect: null };
    }
    const collect = globalThis[provider.api.collect];
    return { provider, collect: typeof collect === "function" ? collect : null };
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!ext?.runtime?.sendMessage) {
        reject(new Error("extension_runtime_unavailable"));
        return;
      }
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

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function leadProfileUrl(lead) {
    return lead?.profile_url || lead?.linkedin_url || "";
  }

  function leadPreviewMeta(lead) {
    const role = [lead?.title, lead?.company, lead?.location].filter(Boolean);
    const contact = [lead?.email, lead?.phone].filter(Boolean);
    if (contact.length > 0) return [...role, contact.join(" · ")].filter(Boolean).join(" · ");
    if (role.length > 0) return role.join(" · ");
    return lead?.headline || leadProfileUrl(lead);
  }

  function leadAvatarUrl(lead) {
    const value = String(lead?.avatar_url || lead?.profile_image_url || lead?.image_url || "").trim();
    return value.startsWith("https://") ? value : "";
  }

  function leadInitials(lead) {
    const parts = String(lead?.name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return (parts[0]?.[0] || BRAND_INITIAL) + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  }

  function updatePageMode() {
    const provider = resolveProvider();
    const detected = provider?.detectImportMode?.(location.href) || "quick";
    state.pageMode = detected === "connections" || detected === "search" ? detected : "quick";
    return state.pageMode;
  }

  function authMessage(code) {
    if (code === "token_required") return t("Connect with your Dgmos access key from the popup to import.");
    if (code === "unauthorized") return t("Dgmos rejected the access key (401). Check that it is active and Public, its allowed IP addresses include {origin}, and it has the \"Lead Management\" module route permission.", { origin: globalThis.DgmosApi?.extensionOrigin() || "chrome-extension://<extension-id>" });
    if (code === "permission_denied") return t("Your Dgmos role lacks the \"Lead Capture\" permission. Ask an admin.");
    if (code === "rate_limited") return t("Too many requests to Dgmos right now. Wait a minute and try again.");
    if (code === "server_error") return t("Dgmos is temporarily unavailable. Try again in a few minutes.");
    if (code === "network") return t("Could not reach Dgmos. Check your connection.");
    if (code === "login_required") return t("Sign in to LinkedIn in this tab, then try again.");
    if (code === "challenge_required") return t("Complete the LinkedIn security check, then rescan.");
    if (code === "search_empty") return t("No search results on this page. Try another query.");
    if (code === "no_leads_found") return t("No importable profiles found. Scroll or change filters.");
    return code || t("Operation failed");
  }

  async function syncPanelSettings() {
    if (!ext?.storage?.sync) return;
    const stored = await ext.storage.sync.get([
      PANEL_SEEN_KEY,
      WORKSPACE_KEY,
      "dgmosLinkedInPanelSeen",
      "organizationName",
      "workspaceName"
    ]);
    state.tutorialSeen = Boolean(stored[PANEL_SEEN_KEY] || stored.dgmosLinkedInPanelSeen);
    // The panel only needs to know whether a key exists; requests go through the background worker.
    state.token = globalThis.DgmosApi ? (await globalThis.DgmosApi.loadAuth(ext)).token : "";
    state.workspaceName =
      stored[WORKSPACE_KEY] || stored.workspaceName || stored.organizationName || "";
  }

  async function markTutorialSeen() {
    state.tutorialSeen = true;
    if (ext?.storage?.sync) {
      await ext.storage.sync.set({ [PANEL_SEEN_KEY]: true });
    }
    renderPanel();
  }

  function setPanelOpen(open, { remember = false } = {}) {
    state.open = open;
    if (remember && !open) {
      void markTutorialSeen();
    }
    renderPanel();
  }

  async function restoreScrapeState() {
    const provider = resolveProvider();
    if (!provider) return;

    let scrape;
    try {
      scrape = await sendRuntimeMessage({ type: "get-scrape-state" });
    } catch {
      return;
    }
    if (!scrape || scrape.providerId !== provider.id) return;

    if (scrape.status === "running") {
      state.scanning = true;
      state.phase = scrape.phase || "scanning";
      state.status = scrape.progress?.message || currentStatusFallback();
      state.sample = Array.isArray(scrape.progress?.sample) ? scrape.progress.sample : state.sample;
      return;
    }

    if (scrape.status === "ready" && Array.isArray(scrape.leads) && scrape.leads.length > 0) {
      state.scanning = false;
      state.phase = "ready";
      state.leads = scrape.leads;
      state.sample = [];
      state.status = `${state.leads.length} connections ready.`;
      return;
    }

    if (scrape.status === "error") {
      state.scanning = false;
      state.phase = "error";
      state.status = scrape.error || t("Scan failed");
    }
  }

  function currentStatusFallback() {
    if (state.pageMode === "connections") {
      return t("Connections page is ready. Scanning scrolls the list in the same tab.");
    }
    if (state.pageMode === "search") {
      return t("Search results page is ready. Scanning scrolls people and company results.");
    }
    return t("You can quickly read visible profiles on this LinkedIn page.");
  }

  function renderPreview() {
    const previewLeads = state.leads.length > 0 ? state.leads : state.sample;
    if (!els.preview) return;
    if (previewLeads.length === 0) {
      els.preview.innerHTML = `<li class="empty">${escapeHtml(t("No leads yet."))}</li>`;
      return;
    }
    els.preview.innerHTML = previewLeads
      .slice(0, 5)
      .map(
        (lead) => `<li>
          ${
            leadAvatarUrl(lead)
              ? `<img class="avatar" src="${escapeHtml(leadAvatarUrl(lead))}" alt="" loading="lazy" />`
              : `<span class="avatar fallback">${escapeHtml(leadInitials(lead).toUpperCase())}</span>`
          }
          <span class="lead-copy">
            <strong>${escapeHtml(lead.name || t("Unnamed record"))}</strong>
            <span>${escapeHtml(leadPreviewMeta(lead))}</span>
          </span>
        </li>`
      )
      .join("");
  }

  function renderPanel() {
    if (!shadow || !els.panel) return;

    const hasToken = Boolean(state.token);
    if (!hasToken) {
      els.panel.classList.add("hidden");
      els.rail.classList.add("hidden");
      return;
    }

    els.panel.classList.remove("hidden");
    els.rail.classList.remove("hidden");

    updatePageMode();

    const isConnections = state.pageMode === "connections";
    const isSearch = state.pageMode === "search";
    const hasLeads = state.leads.length > 0;
    const status = state.status || currentStatusFallback();
    const sendDisabledReason =
      state.scanning || state.sending
        ? ""
        : !hasToken
          ? t("Connect your Dgmos access key from the extension panel first to import.")
          : !hasLeads
            ? isSearch
              ? t("Find leads with Scan search results before importing.")
              : isConnections
                ? t("Find leads with Scan connections before importing.")
                : t("Scan this page before importing.")
            : "";

    els.panel.classList.toggle("open", state.open);
    els.rail.classList.toggle("panel-open", state.open);
    els.tutorial.classList.toggle("hidden", state.tutorialSeen);
    els.pageTag.textContent = isConnections ? t("Connections") : isSearch ? t("Search results") : t("This page");
    els.status.textContent = status;
    els.result.textContent = state.result;
    els.result.classList.toggle("error", state.phase === "error");
    els.scanBtn.textContent = state.scanning
      ? t("Scanning...")
      : isConnections
        ? t("Scan connections")
        : isSearch
          ? t("Scan search results")
          : t("Scan this page");
    els.scanBtn.disabled = state.scanning || state.sending;
    els.sendBtn.textContent = state.sending ? t("Importing...") : t("Save to {brand}", { brand: BRAND_NAME });
    els.sendBtn.disabled = !hasLeads || !hasToken || state.scanning || state.sending;
    els.sendBtn.title = sendDisabledReason;
    els.sendHint.textContent = sendDisabledReason;
    els.sendHint.classList.toggle("hidden", !sendDisabledReason);
    els.openConnectionsBtn.hidden = isConnections;
    if (els.openSearchBtn) {
      els.openSearchBtn.hidden = isSearch;
    }
    els.authNotice.textContent = hasToken
      ? state.workspaceName
        ? t("{workspaceName} connected", { workspaceName: state.workspaceName })
        : t("{brand} account connected", { brand: BRAND_NAME })
      : t("Connect your Dgmos access key from the extension panel to import.");
    // Mode pills
    if (els.modeConnections && els.modeSearch && els.modeQuick) {
      els.modeConnections.classList.toggle("active", isConnections);
      els.modeSearch.classList.toggle("active", isSearch);
      els.modeQuick.classList.toggle("active", !isConnections && !isSearch);
    }
    els.railCount.textContent = String(state.leads.length || state.sample.length || "");
    els.railCount.classList.toggle("hidden", state.leads.length === 0 && state.sample.length === 0);
    renderPreview();
  }

  async function openConnectionsPage() {
    const provider = resolveProvider();
    if (!provider?.entryUrl) return;
    await markTutorialSeen();
    location.href = provider.entryUrl;
  }

  async function openSearchPage() {
    const provider = resolveProvider();
    const url = provider?.searchEntryUrl || "https://www.linkedin.com/search/results/all/";
    await markTutorialSeen();
    location.href = url;
  }

  async function scanFromPanel() {
    const provider = resolveProvider();
    if (!provider) {
      state.phase = "error";
      state.status = t("No provider found for this page.");
      renderPanel();
      return;
    }

    const mode = updatePageMode();
    state.phase = "scanning";
    state.scanning = true;
    state.result = "";
    state.leads = [];
    state.sample = [];
    state.status =
      mode === "connections"
        ? t("Scrolling connections list...")
        : mode === "search"
          ? t("Scrolling search results...")
          : t("Reading page...");
    await markTutorialSeen();
    renderPanel();

    try {
      const response = await sendRuntimeMessage({ type: "scrape-provider-tab", providerId: provider.id, mode });
      if (!response || response.error) {
        throw new Error(response?.error || "scrape_failed");
      }
      state.leads = response.leads || [];
      state.sample = [];
      state.phase = "ready";
      state.status =
        mode === "connections"
          ? t("{count} connections ready. Profile pages were not opened automatically.", { count: state.leads.length })
          : mode === "search"
            ? t("{count} search results ready.", { count: state.leads.length })
            : t("{count} profiles found.", { count: state.leads.length });
    } catch (err) {
      state.phase = "error";
      const code = err instanceof Error ? err.message : "scrape_failed";
      state.status = authMessage(code);
      state.leads = [];
    } finally {
      state.scanning = false;
      renderPanel();
    }
  }

  async function sendFromPanel() {
    await syncPanelSettings();
    if (!state.token) {
      state.phase = "error";
      state.result = authMessage("token_required");
      renderPanel();
      return;
    }
    if (state.leads.length === 0) {
      state.phase = "error";
      state.result = t("No leads to import.");
      renderPanel();
      return;
    }

    const provider = resolveProvider();
    state.sending = true;
    state.phase = "sending";
    state.result = "";
    state.status = t("{count} leads importing to {brand}...", { count: state.leads.length, brand: BRAND_NAME });
    renderPanel();

    try {
      const response = await sendRuntimeMessage({
        type: "send-provider-leads",
        providerId: provider?.id || "linkedin",
        leads: state.leads,
        pageUrl: location.href
      });
      if (!response || response.error) {
        throw new Error(response?.error || "send_failed");
      }
      state.phase = "done";
      state.status = t("Import completed.");
      state.result =
        t("{created} new · {merged} updated · {skipped} skipped", {
          created: response.created || 0,
          merged: response.merged || 0,
          skipped: response.skipped || 0
        }) +
        (response.failed ? ` ${t("· {failed} failed", { failed: response.failed })}` : "") +
        t(". Saved to {brand}.", { brand: BRAND_NAME });
    } catch (err) {
      const code = err instanceof Error ? err.message : "send_failed";
      state.phase = "error";
      state.result = authMessage(code);
    } finally {
      state.sending = false;
      renderPanel();
    }
  }

  function handleScrapeProgress(message) {
    if (!shadow || message?.type !== "scrape-progress") return;

    if (message.phase === "done") {
      state.scanning = false;
      void restoreScrapeState().then(() => renderPanel());
      return;
    }

    if (message.phase === "error") {
      state.scanning = false;
      state.phase = "error";
      state.status = message.error || t("Scan failed");
      renderPanel();
      return;
    }

    state.scanning = true;
    if (message.stage === "scroll") {
      state.phase = "scanning";
      state.status = message.message || t("{found} connections listed", { found: message.found || 0 });
    } else if (message.stage === "parse") {
      state.phase = "parsing";
      state.status = message.message || t("{found} connections processing", { found: message.found || 0 });
    } else if (message.stage === "enrich") {
      state.phase = "enriching";
      state.status = message.message || t("Reading profile details...");
    }
    if (Array.isArray(message.sample)) {
      state.sample = message.sample;
    }
    renderPanel();
  }

  function panelStyles() {
    return `
      :host {
        all: initial;
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .rail {
        position: fixed;
        top: 144px;
        right: 0;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 10px 0 8px;
        border: 1px solid #2b3a2d;
        border-right: 0;
        border-radius: 12px 0 0 12px;
        background: #111713;
        color: #f4f7f2;
        font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
      }

      .rail.panel-open {
        display: none;
      }

      .mark {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 8px;
        overflow: hidden;
        background: #ffffff;
        color: #14210f;
        font-weight: 800;
      }

      .mark img {
        width: 26px;
        height: 26px;
        display: block;
      }

      .count {
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(141, 223, 83, 0.18);
        color: #bdf39b;
        font-size: 11px;
      }

      .panel {
        position: fixed;
        top: 76px;
        right: 14px;
        z-index: 2147483647;
        width: min(372px, calc(100vw - 28px));
        max-height: calc(100vh - 96px);
        display: none;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #29362d;
        border-radius: 16px;
        background: #101511;
        color: #f5f7f3;
        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.42);
      }

      .panel.open {
        display: flex;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px;
        border-bottom: 1px solid #243026;
      }

      .brand {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 10px;
      }

      .brand strong,
      h2,
      p {
        margin: 0;
      }

      .brand strong {
        display: block;
        font-size: 14px;
        line-height: 1.2;
      }

      .brand span:last-child {
        display: block;
        margin-top: 2px;
        color: #9aa79a;
        font-size: 11px;
      }

      .icon-btn {
        width: 30px;
        height: 30px;
        border: 1px solid #2b3a2d;
        border-radius: 8px;
        background: transparent;
        color: #dfe7dc;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }

      .body {
        overflow: auto;
        padding: 14px;
      }

      .tutorial,
      .status-card,
      .auth-card,
      .preview-card {
        border: 1px solid #263228;
        border-radius: 12px;
        background: #151c17;
      }

      .tutorial {
        padding: 13px;
        margin-bottom: 12px;
      }

      .kicker {
        color: #8ddf53;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }

      h2 {
        margin-top: 5px;
        font-size: 16px;
        line-height: 1.3;
      }

      .tutorial ol {
        margin: 10px 0 0;
        padding-left: 18px;
        color: #cbd5c7;
        font-size: 12px;
        line-height: 1.55;
      }

      .tutorial-actions,
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .status-card,
      .auth-card,
      .preview-card {
        padding: 12px;
        margin-top: 10px;
      }

      .tag {
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(141, 223, 83, 0.13);
        color: #bdf39b;
        font-size: 11px;
        font-weight: 700;
      }

      .status-text,
      .auth-card {
        margin-top: 8px;
        color: #cbd5c7;
        font-size: 12px;
        line-height: 1.45;
      }

      button {
        font-family: inherit;
      }

      .primary,
      .secondary {
        min-height: 38px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .primary {
        border: 0;
        background: #8ddf53;
        color: #15200f;
      }

      .secondary {
        border: 1px solid #47613d;
        background: transparent;
        color: #e6eee2;
      }

      .primary:disabled,
      .secondary:disabled {
        opacity: 0.48;
        cursor: not-allowed;
      }

      .link-btn {
        width: 100%;
        margin-top: 10px;
        padding: 0;
        border: 0;
        background: transparent;
        color: #9edb7b;
        cursor: pointer;
        text-align: left;
        font-size: 12px;
        font-weight: 700;
      }

      .preview-card ul {
        max-height: 188px;
        overflow: auto;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .preview-card li {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        padding: 9px 0;
        border-top: 1px solid #263228;
      }

      .preview-card li:first-child {
        border-top: 0;
      }

      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 999px;
        object-fit: cover;
        background: #243026;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
      }

      .avatar.fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #bdf39b;
        font-size: 12px;
        font-weight: 800;
      }

      .lead-copy {
        display: block;
        min-width: 0;
      }

      .preview-card strong {
        display: block;
        color: #f5f7f3;
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lead-copy > span,
      .empty {
        display: block;
        margin-top: 3px;
        color: #96a294;
        font-size: 11px;
        line-height: 1.35;
      }

      .result {
        min-height: 18px;
        margin-top: 10px;
        color: #9edb7b;
        font-size: 12px;
        line-height: 1.45;
      }

      .result.error {
        color: #ff9b8a;
      }

      .send-hint {
        margin: 8px 0 0;
        color: #96a294;
        font-size: 11px;
        line-height: 1.4;
      }

      .mode-row {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
        margin-top: 10px;
      }

      .mode-pill {
        min-height: 32px;
        border: 1px solid #2b3a2d;
        border-radius: 8px;
        background: transparent;
        color: #cbd5c7;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }

      .mode-pill.active {
        border-color: #8ddf53;
        background: rgba(141, 223, 83, 0.14);
        color: #bdf39b;
      }

      .hidden {
        display: none !important;
      }

      @media (max-width: 520px) {
        .panel {
          top: 64px;
          right: 10px;
          width: calc(100vw - 20px);
          max-height: calc(100vh - 78px);
        }
      }
    `;
  }

  function mountPanel() {
    if (!document.body || !resolveProvider()) return;
    document.getElementById(PANEL_HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = PANEL_HOST_ID;
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${panelStyles()}</style>
      <button id="rail" class="rail" type="button" aria-label="${escapeHtml(t("Open {brand} panel", { brand: BRAND_NAME }))}">
        <span class="mark">${BRAND_MARK}</span>
        <span>${BRAND_NAME}</span>
        <span id="railCount" class="count hidden"></span>
      </button>
      <aside id="panel" class="panel" aria-live="polite">
        <header class="head">
          <div class="brand">
            <span class="mark">${BRAND_MARK}</span>
            <span>
              <strong>${BRAND_NAME}</strong>
              <span>${BRAND_TAG}</span>
            </span>
          </div>
          <button id="closeBtn" class="icon-btn" type="button" aria-label="${escapeHtml(t("Close panel"))}">×</button>
        </header>
        <div class="body">
          <section id="tutorial" class="tutorial">
            <p class="kicker">${t("First use")}</p>
            <h2>${t("Import from the right panel on LinkedIn")}</h2>
            <ol>
              <li>${t("Open Connections <strong>or Search</strong>, then stay on results.")}</li>
              <li>${t("Scroll the list in the same tab with Scan.")}</li>
              <li>${escapeHtml(t("Save to {brand}. Enrich runs slowly in small batches after the list is saved (ban-safe).", { brand: BRAND_NAME }))}</li>
            </ol>
            <div class="tutorial-actions">
              <button id="tutorialDoneBtn" class="secondary" type="button">${t("Got it")}</button>
              <button id="tutorialConnectionsBtn" class="primary" type="button">${t("Go to Connections")}</button>
            </div>
          </section>

          <section class="status-card">
            <span id="pageTag" class="tag">${t("This page")}</span>
            <p id="statusText" class="status-text"></p>
          </section>

          <div class="mode-row" role="tablist" aria-label="${escapeHtml(t("Import mode"))}">
            <button id="modeConnections" class="mode-pill" type="button" data-hint="connections">${t("Connections")}</button>
            <button id="modeSearch" class="mode-pill" type="button" data-hint="search">${t("Search")}</button>
            <button id="modeQuick" class="mode-pill" type="button" data-hint="quick">${t("This page")}</button>
          </div>

          <div class="actions">
            <button id="scanBtn" class="primary" type="button">${t("Scan")}</button>
            <button id="sendBtn" class="secondary" type="button" disabled>${escapeHtml(t("Save to {brand}", { brand: BRAND_NAME }))}</button>
          </div>
          <p id="sendHint" class="send-hint hidden"></p>
          <button id="openConnectionsBtn" class="link-btn" type="button">${t("Open Connections page")}</button>
          <button id="openSearchBtn" class="link-btn" type="button">${t("Open LinkedIn search")}</button>

          <section class="auth-card">
            <p id="authNotice"></p>
          </section>

          <section class="preview-card">
            <ul id="previewList"></ul>
            <p id="resultText" class="result"></p>
          </section>
        </div>
      </aside>
    `;
    document.body.appendChild(host);

    els = {
      panel: shadow.getElementById("panel"),
      rail: shadow.getElementById("rail"),
      railCount: shadow.getElementById("railCount"),
      closeBtn: shadow.getElementById("closeBtn"),
      tutorial: shadow.getElementById("tutorial"),
      tutorialDoneBtn: shadow.getElementById("tutorialDoneBtn"),
      tutorialConnectionsBtn: shadow.getElementById("tutorialConnectionsBtn"),
      pageTag: shadow.getElementById("pageTag"),
      status: shadow.getElementById("statusText"),
      scanBtn: shadow.getElementById("scanBtn"),
      sendBtn: shadow.getElementById("sendBtn"),
      sendHint: shadow.getElementById("sendHint"),
      openConnectionsBtn: shadow.getElementById("openConnectionsBtn"),
      openSearchBtn: shadow.getElementById("openSearchBtn"),
      modeConnections: shadow.getElementById("modeConnections"),
      modeSearch: shadow.getElementById("modeSearch"),
      modeQuick: shadow.getElementById("modeQuick"),
      authNotice: shadow.getElementById("authNotice"),
      preview: shadow.getElementById("previewList"),
      result: shadow.getElementById("resultText")
    };

    els.rail.addEventListener("click", () => setPanelOpen(true));
    els.closeBtn.addEventListener("click", () => setPanelOpen(false, { remember: true }));
    els.tutorialDoneBtn.addEventListener("click", () => void markTutorialSeen());
    els.tutorialConnectionsBtn.addEventListener("click", () => void openConnectionsPage());
    els.openConnectionsBtn.addEventListener("click", () => void openConnectionsPage());
    els.openSearchBtn?.addEventListener("click", () => void openSearchPage());
    els.modeConnections?.addEventListener("click", () => void openConnectionsPage());
    els.modeSearch?.addEventListener("click", () => void openSearchPage());
    els.modeQuick?.addEventListener("click", () => {
      state.status = t("Stay on this LinkedIn page, then press Scan.");
      renderPanel();
    });
    els.scanBtn.addEventListener("click", () => void scanFromPanel());
    els.sendBtn.addEventListener("click", () => void sendFromPanel());
  }

  async function initPanel() {
    // Product UI is Chrome Side Panel (toolbar click), not an in-page overlay.
    // Keep this content script for collect/progress messaging only.
    if (!ext?.runtime?.id) return;
    document.getElementById(PANEL_HOST_ID)?.remove();
  }

  function onLiImportMessage(message, _sender, sendResponse) {
    if (message?.type === "ping") {
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "scrape-progress") {
      handleScrapeProgress(message);
      return;
    }
    if (message?.type === "collect-leads") {
      try {
        const { provider, collect } = resolveCollector();
        if (!provider) {
          sendResponse({ leads: [], page_url: location.href, error: "unsupported_provider" });
          return;
        }
        if (!collect) {
          sendResponse({ leads: [], page_url: location.href, provider: provider.id, error: "collector_not_loaded" });
          return;
        }
        sendResponse(collect());
      } catch (err) {
        sendResponse({
          leads: [],
          page_url: location.href,
          error: err instanceof Error ? err.message : "collect failed"
        });
      }
    }
    return true;
  }

  if (globalThis.__liImportOnMessageRegistered) {
    chrome.runtime.onMessage.removeListener(globalThis.__liImportOnMessageRegistered);
  }
  globalThis.__liImportOnMessageRegistered = onLiImportMessage;
  chrome.runtime.onMessage.addListener(onLiImportMessage);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initPanel(), { once: true });
  } else {
    void initPanel();
  }
})();
