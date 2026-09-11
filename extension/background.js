importScripts("config.js", "providers/registry.js");

// Persistent Chrome Side Panel (Custfind-style) — not a transient toolbar popup.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Older Chromium builds may not expose Side Panel.
  });
}

const cfg = globalThis.LI_IMPORT_CONFIG || {};
const SCRAPE_STATE_KEY = `${cfg.storagePrefix || "dgmos_"}scrapeState`;
const DEFAULT_API_BASE = cfg.defaultApiBase || "http://localhost:8088";
const BATCH_SIZE = cfg.limits?.batch || 100;
const STORAGE_PREFIX = cfg.storagePrefix || "dgmos_";

let scrapeCancelled = false;

let scrapeState = {
  status: "idle",
  providerId: "",
  mode: "",
  phase: "idle",
  leads: [],
  progress: null,
  error: ""
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepCancellable(ms, onTick) {
  const total = Math.max(0, ms);
  const end = Date.now() + total;
  while (Date.now() < end) {
    if (scrapeCancelled) throw new Error("cancelled");
    const left = end - Date.now();
    // Keep MV3 service worker alive: never sleep >15s without a tick.
    const slice = Math.min(10000, left);
    if (typeof onTick === "function") {
      try {
        await onTick(Math.ceil(left / 1000), Math.ceil(total / 1000));
      } catch {
        // ignore tick errors
      }
    }
    await sleep(slice);
  }
}

function jitteredMs(baseMs, ratio = 0.3) {
  const base = Math.max(0, Number(baseMs) || 0);
  const r = Math.min(0.9, Math.max(0, Number(ratio) || 0));
  const delta = base * r;
  return Math.round(base - delta + Math.random() * delta * 2);
}

function leadNeedsDetail(lead) {
  const url = leadProfileUrl(lead);
  if (isCompanyEntityUrl(url)) {
    const name = String(lead?.name || lead?.company || "").trim().toLowerCase();
    const title = String(lead?.title || "").trim().toLowerCase();
    const usefulTitle = Boolean(title && title !== name);
    // Company list cards are thin; visit About for industry/website/about/HQ.
    return !(lead?.about || lead?.website || (usefulTitle && lead?.location));
  }
  if (!isPersonProfileUrl(url)) return false;
  // List cards often already have title/company; about/email/phone usually need a profile visit.
  return !(lead?.about || lead?.email || lead?.phone);
}

function enrichDayKey() {
  return `${STORAGE_PREFIX}enrich_day_${new Date().toISOString().slice(0, 10)}`;
}

async function getDailyEnrichCount() {
  try {
    const key = enrichDayKey();
    const stored = await chrome.storage.local.get([key]);
    return Number(stored[key] || 0) || 0;
  } catch {
    return 0;
  }
}

async function addDailyEnrichCount(n) {
  if (!n) return;
  try {
    const key = enrichDayKey();
    const current = await getDailyEnrichCount();
    await chrome.storage.local.set({ [key]: current + n });
  } catch {
    // ignore
  }
}

async function loadScrapeState() {
  try {
    const stored = await chrome.storage.session.get(SCRAPE_STATE_KEY);
    if (stored?.[SCRAPE_STATE_KEY]) {
      scrapeState = { ...scrapeState, ...stored[SCRAPE_STATE_KEY] };
    }
  } catch {
    // session storage may be unavailable
  }
}

async function persistScrapeState(patch = {}) {
  scrapeState = { ...scrapeState, ...patch };
  try {
    await chrome.storage.session.set({ [SCRAPE_STATE_KEY]: scrapeState });
  } catch {
    // ignore persistence errors
  }
}

function phaseFromProgress(payload) {
  if (payload.stage === "scroll") return "scanning";
  if (payload.stage === "parse") return "parsing";
  if (payload.stage === "enrich") return "enriching";
  return scrapeState.phase || "idle";
}

function reportProgress(payload, tabId) {
  const phase = phaseFromProgress(payload);
  void persistScrapeState({ progress: payload, phase });
  try {
    chrome.runtime.sendMessage({
      type: "scrape-progress",
      providerId: scrapeState.providerId,
      mode: scrapeState.mode,
      ...payload
    });
  } catch {
    // popup may be closed
  }
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: "scrape-progress",
      providerId: scrapeState.providerId,
      mode: scrapeState.mode,
      ...payload
    }).catch(() => {
      // content panel may not be mounted on this tab
    });
  }
}

function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

async function loadSessionFeatures() {
  try {
    const key = storageKey("features");
    const stored = await chrome.storage.sync.get([key, "features"]);
    return stored[key] || stored.features || null;
  } catch {
    return null;
  }
}

async function resolveRuntimeFeatures() {
  const resolve =
    globalThis.liImportResolveFeatures ||
    globalThis.liImportProviderRegistry?.resolveFeatures ||
    null;
  const sessionFeatures = await loadSessionFeatures();
  if (typeof resolve === "function") {
    return resolve.length >= 2 ? resolve(cfg, sessionFeatures) : resolve(sessionFeatures);
  }
  const aiProvider = String(cfg.aiProvider || "").trim().toLowerCase();
  const aiEnabled = Boolean(aiProvider) && aiProvider !== "none";
  const skipEnrichWithoutAi = cfg.skipEnrichWithoutAi !== false;
  let enrichEnabled = cfg.inlineEnrichDuringScan === true && cfg.enrichProfiles !== false;
  if (skipEnrichWithoutAi && !aiEnabled) enrichEnabled = false;
  const backgroundEnrichEnabled =
    cfg.backgroundEnrichListed !== false && cfg.enrichProfiles !== false;
  return {
    aiEnabled,
    enrichEnabled,
    backgroundEnrichEnabled,
    inlineEnrichDuringScan: enrichEnabled,
    aiProvider: aiEnabled ? aiProvider : "",
    skipEnrichWithoutAi
  };
}

function getProvider(providerId) {
  return globalThis.liImportProviderRegistry?.getProvider(providerId) || null;
}

async function getProviderForRun(providerId) {
  const base = getProvider(providerId);
  const features = await loadSessionFeatures();
  const wrap = globalThis.liImportProviderRegistry?.withRuntimeFeatures;
  if (typeof wrap === "function") return wrap(base, features) || base;
  return base;
}

function normalizeApiBase(value) {
  return (value || DEFAULT_API_BASE).trim().replace(/\/$/, "");
}

function leadProfileUrl(lead) {
  return lead?.profile_url || lead?.linkedin_url || "";
}

function normalizeLeadsForApi(rawLeads) {
  return rawLeads.map((lead) => {
    const title = (lead.title || lead.headline || "").trim();
    const company = (lead.company || "").trim();
    const enrichStatus = String(lead.enrich_status || "").trim().toLowerCase();
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

async function loadExtensionAuth() {
  const keys = [STORAGE_PREFIX + "apiBase", STORAGE_PREFIX + "token", "apiBase", "token"];
  const stored = await chrome.storage.sync.get(keys);
  return {
    apiBase: normalizeApiBase(stored[STORAGE_PREFIX + "apiBase"] || stored.apiBase),
    token: (stored[STORAGE_PREFIX + "token"] || stored.token || "").trim()
  };
}

const BG_ENRICH_ALARM = "li-import-bg-enrich";
const BG_STATE_KEY = `${STORAGE_PREFIX}bgEnrich`;
let bgEnrichRunning = false;

async function loadBgEnrichState() {
  try {
    const stored = await chrome.storage.local.get([BG_STATE_KEY]);
    return stored[BG_STATE_KEY] || { status: "idle", message: "" };
  } catch {
    return { status: "idle", message: "" };
  }
}

async function persistBgEnrichState(patch = {}) {
  const current = await loadBgEnrichState();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  try {
    await chrome.storage.local.set({ [BG_STATE_KEY]: next });
  } catch {
    // ignore
  }
  return next;
}

async function scheduleBackgroundEnrich({ immediate = false } = {}) {
  const features = await resolveRuntimeFeatures();
  if (!features.backgroundEnrichEnabled) {
    await persistBgEnrichState({
      status: "idle",
      message: "Background enrich disabled"
    });
    return { ok: false, reason: "disabled" };
  }

  const delayMin = immediate
    ? Math.max(0.5, Number(cfg.backgroundEnrichIntervalMinutes) || 2)
    : Math.max(1, Number(cfg.backgroundEnrichDelayMinutes) || 3);
  const when = Date.now() + delayMin * 60 * 1000;

  if (chrome.alarms?.create) {
    await chrome.alarms.clear(BG_ENRICH_ALARM);
    chrome.alarms.create(BG_ENRICH_ALARM, { when });
  }

  const state = await persistBgEnrichState({
    status: "scheduled",
    phase: "queued",
    nextRunAt: when,
    currentName: "",
    currentUrl: "",
    message: immediate
      ? `Queued — next batch in ~${Math.round(delayMin)} min`
      : `Queued — waiting ~${Math.round(delayMin)} min before first detail visit (ban-safe)`
  });
  return { ok: true, state };
}

/** If listed leads remain and no active schedule/run, queue a delayed ban-safe tick. */
async function ensureBackgroundEnrichQueued({ force = false } = {}) {
  const features = await resolveRuntimeFeatures();
  if (!features.backgroundEnrichEnabled) {
    return { ok: false, reason: "disabled" };
  }

  let listed = 0;
  try {
    const page = await fetchListedLeadsForEnrich(1);
    listed = Number(page.totals?.listed || 0);
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: code };
  }
  if (listed <= 0) {
    await persistBgEnrichState({
      status: "done",
      remaining: 0,
      phase: "done",
      message: "Nothing waiting — queue is clear"
    });
    return { ok: true, listed: 0 };
  }

  const current = await loadBgEnrichState();
  if (!force && (current.status === "scheduled" || current.status === "running")) {
    return { ok: true, listed, state: current, already: true };
  }

  const planned = await scheduleBackgroundEnrich({ immediate: false });
  await persistBgEnrichState({
    ...(planned.state || {}),
    remaining: listed,
    phase: "queued",
    message: `${listed} waiting in queue · detail visits start in ~${cfg.backgroundEnrichDelayMinutes || 3} min`
  });
  return { ok: true, listed, state: await loadBgEnrichState() };
}

async function fetchListedLeadsForEnrich(limit = 6) {
  const { apiBase, token } = await loadExtensionAuth();
  if (!token) throw new Error("token_required");
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(40, limit))),
    enrich_status: "listed",
    sort: "oldest"
  });
  const res = await fetch(`${apiBase}/v1/leads?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return {
    items: body.items || [],
    totals: body.totals || {},
    nextCursor: body.next_cursor || ""
  };
}

async function ensureLinkedInTab() {
  const existing = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  if (existing[0]?.id) return existing[0].id;
  const tab = await chrome.tabs.create({
    url: "https://www.linkedin.com/feed/",
    active: false
  });
  await waitForTabLoad(tab.id).catch(() => {});
  await sleep(1200);
  return tab.id;
}

async function runBackgroundEnrichTick() {
  if (bgEnrichRunning) return { ok: false, reason: "busy" };
  if (scrapeState.status === "running") {
    await scheduleBackgroundEnrich({ immediate: true });
    return { ok: false, reason: "scrape_running" };
  }

  const features = await resolveRuntimeFeatures();
  if (!features.backgroundEnrichEnabled) {
    await persistBgEnrichState({ status: "idle", message: "Background enrich disabled" });
    return { ok: false, reason: "disabled" };
  }

  bgEnrichRunning = true;
  scrapeCancelled = false;
  try {
    const batchSize = Math.max(1, Math.min(10, Number(cfg.enrichBatchSize) || 6));
    const listed = await fetchListedLeadsForEnrich(batchSize);
    const remaining = Number(listed.totals.listed || 0);
    if (!listed.items.length) {
      await persistBgEnrichState({
        status: "done",
        phase: "done",
        remaining: 0,
        currentName: "",
        currentUrl: "",
        message: "Nothing waiting — queue is clear"
      });
      return { ok: true, done: true };
    }

    await persistBgEnrichState({
      status: "running",
      phase: "enriching",
      remaining,
      currentName: "",
      currentUrl: "",
      message: `In progress — visiting ${listed.items.length} of ${remaining} waiting leads`
    });

    const provider = await getProviderForRun("linkedin");
    if (!provider?.enabled) throw new Error("unsupported_provider");

    const leads = listed.items.map((row) => ({
      name: row.name,
      profile_url: row.profile_url,
      linkedin_url: row.linkedin_url || row.profile_url,
      title: row.title,
      company: row.company,
      location: row.location,
      email: row.email,
      phone: row.phone,
      website: row.website,
      headline: row.headline,
      about: row.about
    }));

    const tabId = await ensureLinkedInTab();
    await enrichLinkedInProfiles(tabId, provider, leads, {
      pageUrl: "",
      returnUrl: "",
      enrichCfg: {
        ...(provider.scrape || {}),
        enrichProfiles: true,
        enrichBatchSize: batchSize,
        enrichSessionMax: Math.min(batchSize, Number(cfg.enrichSessionMax) || 40),
        enrichOnlyMissing: true
      },
      background: true,
      skipSkeletonSave: true
    });

    const after = await fetchListedLeadsForEnrich(1);
    const still = Number(after.totals.listed || 0);
    if (still > 0) {
      await scheduleBackgroundEnrich({ immediate: true });
      await persistBgEnrichState({
        status: "scheduled",
        phase: "queued",
        remaining: still,
        currentName: "",
        currentUrl: "",
        message: `Batch done · ${still} still queued — next visit later (ban-safe)`
      });
    } else {
      await persistBgEnrichState({
        status: "done",
        phase: "done",
        remaining: 0,
        currentName: "",
        currentUrl: "",
        message: "All waiting leads are done"
      });
    }
    return { ok: true, remaining: still };
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    await persistBgEnrichState({
      status: "paused",
      message: `Background enrich paused (${code}). Will retry later.`
    });
    if (code !== "unauthorized" && code !== "token_required") {
      await scheduleBackgroundEnrich({ immediate: true });
    }
    return { ok: false, error: code };
  } finally {
    bgEnrichRunning = false;
  }
}

async function saveListedLeadsAndQueueBackground(provider, leads, pageUrl = "") {
  let saveResult = null;
  try {
    saveResult = await sendLeadsToApi({
      providerId: provider.id,
      leads,
      pageUrl
    });
    reportProgress({
      stage: "parse",
      phase: "done",
      found: leads.length,
      message: `Saved ${leads.length} · ${saveResult.created} new · ${saveResult.merged} updated · status: Waiting`
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    reportProgress({
      stage: "parse",
      phase: "done",
      found: leads.length,
      message: code === "token_required"
        ? "List ready locally — connect token to save & queue detail enrich."
        : `List ready; save skipped (${code})`
    });
  }

  const features = await resolveRuntimeFeatures();
  if (features.backgroundEnrichEnabled && saveResult) {
    const planned = await scheduleBackgroundEnrich({ immediate: false });
    reportProgress({
      stage: "parse",
      phase: "done",
      found: leads.length,
      background: true,
      message: planned.state?.message || "Queued for later — detail visits start after a short wait (ban-safe)."
    });
  }
  return saveResult;
}

async function sendLeadsToApi({ providerId, leads, pageUrl }) {
  const { apiBase, token } = await loadExtensionAuth();
  if (!token) {
    throw new Error("token_required");
  }

  const payloadLeads = normalizeLeadsForApi(leads || []);
  let created = 0;
  let merged = 0;
  let skipped = 0;

  for (let offset = 0; offset < payloadLeads.length; offset += BATCH_SIZE) {
    const chunk = payloadLeads.slice(offset, offset + BATCH_SIZE);
    const res = await fetch(`${apiBase}/v1/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        provider: providerId,
        leads: chunk,
        page_url: pageUrl
      })
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    created += body.created ?? 0;
    merged += body.merged ?? 0;
    skipped += body.skipped ?? 0;
  }

  return { created, merged, skipped, total: payloadLeads.length };
}

async function injectCollector(tabId, provider) {
  const files = ["config.js", "providers/registry.js"];
  if (provider.id === "linkedin") {
    files.push("providers/linkedin/core.js");
  }
  files.push(provider.collectorFile);
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files
  });
}

async function runInTab(tabId, func, args = []) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func,
    args
  });
  return execution?.result;
}

async function collectSnapshot(tabId, provider, mode) {
  return runInTab(
    tabId,
    (providerId, importMode) => {
      const registry = globalThis.liImportProviderRegistry;
      const active = registry?.getProvider(providerId);
      if (!active) {
        return { leads: [], page_url: location.href, error: "unsupported_provider" };
      }

      if (importMode === "connections" && active.api.parseConnections) {
        const parse = globalThis[active.api.parseConnections];
        if (typeof parse === "function") {
          return {
            provider: providerId,
            leads: parse(),
            page_url: location.href,
            page_type: "connections"
          };
        }
      }

      if (importMode === "search" && active.api.parseSearch) {
        const parse = globalThis[active.api.parseSearch];
        if (typeof parse === "function") {
          return {
            provider: providerId,
            leads: parse(),
            page_url: location.href,
            page_type: "search"
          };
        }
      }

      const collect = globalThis[active.api.collect];
      return typeof collect === "function"
        ? collect()
        : { leads: [], page_url: location.href, provider: providerId, error: "collector_not_loaded" };
    },
    [provider.id, mode]
  ).then((result) => result || { leads: [], page_url: "" });
}

async function scrollOnce(tabId, provider) {
  if (!provider.api.scrollOnce) return;
  await runInTab(
    tabId,
    (scrollGlobal) => {
      const scroll = globalThis[scrollGlobal];
      if (typeof scroll === "function") scroll();
    },
    [provider.api.scrollOnce]
  );
}

function mergeLeads(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const pickName = () => {
    const a = existing.name || "";
    const b = incoming.name || "";
    if (!b) return a;
    if (!a) return b;
    if (/\s/.test(b) && !/\s/.test(a)) return b;
    if (/\s/.test(a) && !/\s/.test(b)) return a;
    return b.length > a.length ? b : a;
  };

  return {
    ...existing,
    name: pickName(),
    profile_url: existing.profile_url || incoming.profile_url || existing.linkedin_url || incoming.linkedin_url,
    linkedin_url: existing.linkedin_url || incoming.linkedin_url,
    avatar_url: incoming.avatar_url || existing.avatar_url,
    profile_image_url: incoming.profile_image_url || existing.profile_image_url,
    headline: incoming.headline || existing.headline,
    title: incoming.title || existing.title,
    company: incoming.company || existing.company,
    location: incoming.location || existing.location,
    email: incoming.email || existing.email,
    phone: incoming.phone || existing.phone,
    website: incoming.website || existing.website,
    about: incoming.about || existing.about,
    connected_at: incoming.connected_at || existing.connected_at
  };
}

function isPersonProfileUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return /\/in\/[^/]+/i.test(pathname) && !/\/company\//i.test(pathname);
  } catch {
    return false;
  }
}

function isCompanyEntityUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return /^\/company\/[^/]+/i.test(pathname) && !/\/company\/[^/]+\/people/i.test(pathname);
  } catch {
    return false;
  }
}

function companyAboutUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/company\/([^/]+)/i);
    if (!match) return url;
    parsed.pathname = `/company/${match[1]}/about/`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

async function navigateTab(tabId, url) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("navigation_timeout"));
    }, 45000);

    function onUpdated(id, info) {
      if (id !== tabId) return;
      if (info.status === "complete") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(err);
    });
  });
  await sleep(1400);
}

async function parseProfileInTab(tabId, provider) {
  await injectCollector(tabId, provider);

  if (provider.api.pageGate) {
    const gate = await runInTab(
      tabId,
      (gateGlobal) => {
        const fn = globalThis[gateGlobal];
        return typeof fn === "function" ? fn() : { ok: true, error: "" };
      },
      [provider.api.pageGate]
    );
    if (gate && gate.ok === false) {
      throw new Error(gate.error || "page_blocked");
    }
  }

  const parseGlobal = provider.api.parseProfile || "liImportLinkedInParseProfile";
  const detail = await runInTab(
    tabId,
    async (globalName) => {
      const fn = globalThis[globalName];
      if (typeof fn !== "function") return null;
      return await fn();
    },
    [parseGlobal]
  );
  return detail || null;
}

async function enrichLinkedInProfiles(sourceTabId, provider, leads, {
  returnUrl = "",
  enrichCfg = null,
  pageUrl = "",
  background = false,
  skipSkeletonSave = false
} = {}) {
  const features = await resolveRuntimeFeatures();
  const limits = enrichCfg || provider.scrape || {};
  const enrichAllowed = background
    ? features.backgroundEnrichEnabled && cfg.enrichProfiles !== false
    : features.enrichEnabled && limits.enrichProfiles !== false;
  if (!enrichAllowed) {
    const reason = background
      ? "Background enrich disabled"
      : !features.aiEnabled && features.skipEnrichWithoutAi !== false
        ? "No AI provider — skipping inline enrich (list saved; background may still run)."
        : `${leads.length} listed; inline enrich disabled`;
    reportProgress({
      stage: "parse",
      phase: "done",
      found: leads.length,
      message: reason
    }, sourceTabId);
    return leads;
  }

  const pauseMs = limits.enrichPauseMs ?? cfg.enrichPauseMs ?? 5500;
  const pauseJitter = limits.enrichPauseJitter ?? cfg.enrichPauseJitter ?? 0.35;
  const batchSize = Math.max(1, limits.enrichBatchSize ?? cfg.enrichBatchSize ?? 6);
  const batchPauseMs = limits.enrichBatchPauseMs ?? cfg.enrichBatchPauseMs ?? 25000;
  const batchPauseJitter = limits.enrichBatchPauseJitter ?? cfg.enrichBatchPauseJitter ?? 0.25;
  const sessionMax = Math.max(1, limits.enrichSessionMax ?? cfg.enrichSessionMax ?? 40);
  const dailyMax = Math.max(1, limits.enrichDailyMax ?? cfg.enrichDailyMax ?? 120);
  const hardMax = Math.max(1, limits.enrichMax ?? cfg.limits?.enrichMax ?? sessionMax);
  const onlyMissing = limits.enrichOnlyMissing !== false;

  // Ban-safe: save skeleton list first so cancel/cap still leaves data on the host.
  if (!skipSkeletonSave) {
    try {
      reportProgress({
        stage: "enrich",
        phase: "start",
        found: leads.length,
        message: `List done. Saving ${leads.length} leads (skeleton)…`
      }, sourceTabId);
      const saved = await sendLeadsToApi({
        providerId: provider.id,
        leads,
        pageUrl: pageUrl || returnUrl || ""
      });
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        saved: saved.created + saved.merged,
        message: `Skeleton saved · ${saved.created} new · ${saved.merged} updated`
      }, sourceTabId);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        message: code === "token_required"
          ? "No token yet — continuing enrich locally; connect to save."
          : `Skeleton save skipped (${code}); continuing enrich.`
      }, sourceTabId);
    }
  } else {
    reportProgress({
      stage: "enrich",
      phase: "start",
      found: leads.length,
      background: true,
      message: `Background enrich tick · ${leads.length} listed profiles`
    }, sourceTabId);
  }

  const dailyUsed = await getDailyEnrichCount();
  const dailyLeft = Math.max(0, dailyMax - dailyUsed);
  const sessionCap = Math.min(sessionMax, hardMax, dailyLeft);

  if (sessionCap === 0) {
    reportProgress({
      stage: "enrich",
      phase: "done",
      found: leads.length,
      enriched: 0,
      total: 0,
      message: `Daily enrich cap reached (${dailyMax}). Listed leads were saved; background will retry later.`
    }, sourceTabId);
    if (!background) await scheduleBackgroundEnrich({ immediate: false });
    return leads;
  }

  const eligible = [];
  const alreadyEnough = [];
  for (const lead of leads) {
    const url = leadProfileUrl(lead);
    const enrichable = isPersonProfileUrl(url) || isCompanyEntityUrl(url);
    if (!enrichable) continue;
    if (onlyMissing && !leadNeedsDetail(lead)) {
      // List fields already enough — still advance queue (otherwise same 6 loop forever).
      alreadyEnough.push({ ...lead, enrich_status: "enriched" });
      continue;
    }
    eligible.push(lead);
  }

  if (alreadyEnough.length > 0) {
    try {
      await sendLeadsToApi({
        providerId: provider.id,
        leads: alreadyEnough,
        pageUrl: pageUrl || returnUrl || ""
      });
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        enriched: alreadyEnough.length,
        message: `Marked ${alreadyEnough.length} done (list detail already enough)`
      }, sourceTabId);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        message: `Could not mark enough-detail leads done (${code})`
      }, sourceTabId);
    }
  }

  const deferred = Math.max(0, eligible.length - sessionCap);
  const queue = eligible.slice(0, sessionCap);

  if (queue.length === 0) {
    reportProgress({
      stage: "enrich",
      phase: "done",
      found: leads.length,
      enriched: alreadyEnough.length,
      total: 0,
      message: alreadyEnough.length
        ? `Advanced ${alreadyEnough.length} leads · none need a profile visit`
        : onlyMissing
          ? "No profiles/companies need detail enrich (list fields enough)."
          : "No profiles or companies to enrich"
    }, sourceTabId);
    return leads;
  }

  reportProgress({
    stage: "enrich",
    phase: "start",
    found: leads.length,
    enriched: 0,
    total: queue.length,
    deferred,
    batchSize,
    message: deferred
      ? `Ban-safe enrich: ${queue.length} this session · ${deferred} deferred · batch ${batchSize}`
      : `Ban-safe enrich: ${queue.length} pages · batch ${batchSize}`
  }, sourceTabId);

  const byUrl = new Map();
  for (const lead of leads) {
    const key = leadProfileUrl(lead);
    if (key) byUrl.set(key, lead);
  }

  let enriched = 0;
  let skipped = 0;
  let savedBatches = 0;
  let consecutiveFailures = 0;
  const pendingBatch = [];

  async function flushBatch(reason) {
    if (pendingBatch.length === 0) return;
    const chunk = pendingBatch.splice(0, pendingBatch.length);
    try {
      const result = await sendLeadsToApi({
        providerId: provider.id,
        leads: chunk,
        pageUrl: pageUrl || returnUrl || ""
      });
      savedBatches += 1;
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        enriched,
        skipped,
        total: queue.length,
        savedBatches,
        message: `Batch saved (${reason}) · ${result.created} new · ${result.merged} updated`
      }, sourceTabId);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      reportProgress({
        stage: "enrich",
        phase: "progress",
        found: leads.length,
        enriched,
        skipped,
        total: queue.length,
        message: `Batch save failed (${code}) — details kept locally`
      }, sourceTabId);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    if (scrapeCancelled) {
      await flushBatch("cancel");
      throw new Error("cancelled");
    }

    const lead = queue[index];
    const profileUrl = leadProfileUrl(lead);
    const isCompany = isCompanyEntityUrl(profileUrl);
    const navigateUrl = isCompany ? companyAboutUrl(profileUrl) : profileUrl;
    const batchIndex = Math.floor(index / batchSize) + 1;
    const batchCount = Math.ceil(queue.length / batchSize);
    const entityLabel = isCompany ? "company" : "profile";

    reportProgress({
      stage: "enrich",
      phase: "progress",
      index: index + 1,
      total: queue.length,
      found: leads.length,
      enriched,
      skipped,
      deferred,
      batchIndex,
      batchCount,
      name: lead.name || "",
      message: `Opening ${lead.name || entityLabel} (${index + 1}/${queue.length}, batch ${batchIndex}/${batchCount})…`,
      sample: [lead]
    }, sourceTabId);

    if (background) {
      await persistBgEnrichState({
        status: "running",
        phase: "enriching",
        currentName: lead.name || entityLabel,
        currentUrl: profileUrl,
        tickIndex: index + 1,
        tickTotal: queue.length,
        message: `In progress: ${lead.name || entityLabel} (${index + 1}/${queue.length})`
      });
    }

    try {
      await navigateTab(sourceTabId, navigateUrl);
      if (scrapeCancelled) {
        await flushBatch("cancel");
        throw new Error("cancelled");
      }

      const detail = await parseProfileInTab(sourceTabId, provider);
      if (detail) {
        const merged = { ...mergeLeads(lead, detail), enrich_status: "enriched" };
        const key = leadProfileUrl(merged) || profileUrl;
        byUrl.set(profileUrl, merged);
        byUrl.set(key, merged);
        if (isCompany) {
          byUrl.set(companyAboutUrl(profileUrl).replace(/\/about\/?$/i, ""), merged);
        }
        if (detail.profile_url) byUrl.set(detail.profile_url, merged);
        pendingBatch.push(merged);
        enriched += 1;
        consecutiveFailures = 0;
        await addDailyEnrichCount(1);
        reportProgress({
          stage: "enrich",
          phase: "progress",
          index: index + 1,
          total: queue.length,
          found: leads.length,
          enriched,
          skipped,
          deferred,
          batchIndex,
          batchCount,
          name: merged.name || lead.name || "",
          detail: [merged.title, merged.website || merged.location, merged.email].filter(Boolean).join(" · "),
          message: `Enriched ${merged.name || lead.name || entityLabel} (${index + 1}/${queue.length})`,
          sample: [merged]
        }, sourceTabId);
      } else if (background) {
        // Visited but thin/empty parse — still mark Done so the queue advances.
        const marked = { ...lead, enrich_status: "enriched" };
        byUrl.set(profileUrl, marked);
        pendingBatch.push(marked);
        skipped += 1;
        consecutiveFailures = 0;
        await addDailyEnrichCount(1);
        reportProgress({
          stage: "enrich",
          phase: "progress",
          index: index + 1,
          total: queue.length,
          found: leads.length,
          enriched,
          skipped,
          deferred,
          name: lead.name || "",
          message: `Visited ${lead.name || entityLabel} (thin parse) · marked Done (${index + 1}/${queue.length})`,
          sample: [marked]
        }, sourceTabId);
      } else {
        skipped += 1;
        consecutiveFailures += 1;
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (code === "cancelled") {
        await flushBatch("cancel");
        throw err;
      }
      if (code === "login_required" || code === "challenge_required") {
        await flushBatch("challenge-stop");
        reportProgress({
          stage: "enrich",
          phase: "done",
          found: leads.length,
          enriched,
          skipped,
          total: queue.length,
          deferred: deferred + (queue.length - index),
          message: `Stopped: LinkedIn ${code.replace(/_/g, " ")}. Complete the check, then rescan later.`
        }, sourceTabId);
        throw err;
      }
      skipped += 1;
      consecutiveFailures += 1;
      reportProgress({
        stage: "enrich",
        phase: "progress",
        index: index + 1,
        total: queue.length,
        found: leads.length,
        enriched,
        skipped,
        name: lead.name || "",
        message: `Skipped ${lead.name || "profile"} (${code})`,
        sample: [lead]
      }, sourceTabId);

      if (consecutiveFailures >= 3) {
        await flushBatch("error-stop");
        throw new Error("enrich_aborted_errors");
      }
      // Soft backoff after a failure
      await sleepCancellable(jitteredMs(pauseMs * 1.5, pauseJitter), async (leftSec) => {
        reportProgress({
          stage: "enrich",
          phase: "progress",
          index: index + 1,
          total: queue.length,
          found: leads.length,
          enriched,
          skipped,
          message: `Backoff ${leftSec}s after error…`
        }, sourceTabId);
      });
    }

    const finishedBatch = (index + 1) % batchSize === 0 || index === queue.length - 1;
    if (finishedBatch) {
      await flushBatch(`batch ${batchIndex}`);
      if (index < queue.length - 1) {
        const rest = jitteredMs(batchPauseMs, batchPauseJitter);
        await sleepCancellable(rest, async (leftSec, totalSec) => {
          reportProgress({
            stage: "enrich",
            phase: "progress",
            index: index + 1,
            total: queue.length,
            found: leads.length,
            enriched,
            skipped,
            deferred,
            message: `Batch rest ${leftSec}s left / ${totalSec}s (ban-safe)…`
          }, sourceTabId);
        });
        reportProgress({
          stage: "enrich",
          phase: "progress",
          index: index + 1,
          total: queue.length,
          found: leads.length,
          enriched,
          skipped,
          deferred,
          message: `Resuming enrich (${index + 2}/${queue.length})…`
        }, sourceTabId);
      }
    } else if (index < queue.length - 1) {
      await sleepCancellable(jitteredMs(pauseMs, pauseJitter));
    }
  }

  reportProgress({
    stage: "enrich",
    phase: "done",
    found: leads.length,
    enriched,
    skipped,
    total: queue.length,
    deferred,
    savedBatches,
    message:
      `Enriched ${enriched}/${queue.length}` +
      (deferred ? ` · ${deferred} deferred` : "") +
      (skipped ? ` · ${skipped} skipped` : "") +
      (savedBatches ? ` · ${savedBatches} batches saved` : "")
  }, sourceTabId);

  if (deferred > 0 && !background) {
    await scheduleBackgroundEnrich({ immediate: false });
  }

  if (returnUrl) {
    try {
      await navigateTab(sourceTabId, returnUrl);
    } catch {
      // leave user on last profile if return navigation fails
    }
  }

  return leads.map((lead) => {
    const key = leadProfileUrl(lead);
    return (key && byUrl.get(key)) || lead;
  });
}

async function scrapeConnectionsIncremental(tabId, provider) {
  return scrapeListIncremental(tabId, provider, "connections");
}

async function scrapeSearchIncremental(tabId, provider) {
  return scrapeListIncremental(tabId, provider, "search");
}

function waitForTabLoad(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("linkedin_search_timeout"));
    }, timeoutMs);

    function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function linkedinSearchUrl(query, searchType, page, existingUrl = "") {
  const kind = searchType === "people" ? "people" : "companies";
  let url;
  try {
    url = new URL(existingUrl);
    if (!url.hostname.endsWith("linkedin.com")) throw new Error("not_linkedin");
  } catch {
    url = new URL(`https://www.linkedin.com/search/results/${kind}/`);
  }
  url.pathname = `/search/results/${kind}/`;
  url.searchParams.set("keywords", query);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  return url.toString();
}

async function clickLinkedInNextPage(tabId, expectedPage) {
  const clicked = await runInTab(tabId, () => {
    const next = document.querySelector('button[data-testid="pagination-controls-next-button-visible"]');
    if (!next || next.disabled) return false;
    next.scrollIntoView({ block: "center" });
    next.focus();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      next.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    next.click();
    return true;
  });
  if (!clicked) return false;

  const timeoutAt = Date.now() + 20000;
  while (Date.now() < timeoutAt) {
    await sleep(350);
    if (scrapeCancelled) throw new Error("cancelled");
    const reached = await runInTab(
      tabId,
      (page) => {
        const active = document.querySelector('button[aria-current="true"]');
        const label = active?.getAttribute("aria-label") || "";
        const testId = active?.getAttribute("data-testid") || "";
        return new RegExp(`(^|\\D)${page}(\\D|$)`).test(label) || testId === `pagination-indicator-${page - 1}`;
      },
      [expectedPage]
    );
    if (reached) return true;
  }
  return false;
}

async function applyLinkedInFilters(tabId, filters = {}) {
  const location = String(filters.location || "").trim();
  const industry = String(filters.industry || "").trim();
  const groups = [
    location ? { label: location, addLabel: "Add a location" } : null,
    industry ? { label: industry, addLabel: "Add an industry" } : null
  ].filter(Boolean);
  // Also try Turkish labels LinkedIn TR UI uses.
  const localized = [
    location ? { label: location, addLabel: "Konum ekleyin" } : null,
    industry ? { label: industry, addLabel: "Sektör ekleyin" } : null
  ].filter(Boolean);
  const items = groups.length ? groups : [];
  if (!items.length && !localized.length) return;
  const filterItems = items.length ? items : localized;

  reportProgress({ stage: "filter", phase: "progress", found: 0, message: "Opening LinkedIn filters…" }, tabId);
  const opened = await runInTab(tabId, () => {
    const compact = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const trigger = [...document.querySelectorAll("button, [role='button'], a")].find((node) =>
      /(^|\s)(all filters|tüm filtreler)(\s|$)/i.test(compact(node.textContent || node.getAttribute("aria-label")))
    );
    if (!trigger) return false;
    trigger.scrollIntoView({ block: "center" });
    trigger.click();
    return true;
  });
  if (!opened) {
    reportProgress({ stage: "filter", phase: "progress", found: 0, message: "Filters UI not found — continuing without filters." }, tabId);
    return;
  }

  const deadline = Date.now() + 10000;
  let modalReady = false;
  while (Date.now() < deadline) {
    modalReady = await runInTab(tabId, () =>
      Boolean(document.querySelector("#SearchResults_AllFilters, [componentkey='SearchResults_AllFilters']"))
    );
    if (modalReady) break;
    await sleep(250);
  }
  if (!modalReady) {
    reportProgress({ stage: "filter", phase: "progress", found: 0, message: "Filter modal timeout — continuing." }, tabId);
    return;
  }

  await runInTab(
    tabId,
    (wanted) => {
      const compact = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const modal = document.querySelector("#SearchResults_AllFilters, [componentkey='SearchResults_AllFilters']");
      if (!modal) return 0;
      let applied = 0;
      for (const item of wanted) {
        const option = [...modal.querySelectorAll("[role='checkbox'][aria-label]")].find(
          (node) => compact(node.getAttribute("aria-label")).includes(compact(item.label))
        );
        if (!option) continue;
        if (option.getAttribute("aria-checked") !== "true") option.click();
        applied += 1;
      }
      const apply = [...modal.querySelectorAll("button, a, [role='button']")].find((node) =>
        /^(show results|sonuçları göster)$/i.test(compact(node.textContent || node.getAttribute("aria-label")))
      );
      if (apply) apply.click();
      return applied;
    },
    [filterItems]
  );
  await sleep(1100);
  reportProgress({ stage: "filter", phase: "progress", found: 0, message: "Filters applied." }, tabId);
}

async function searchLinkedIn(tabId, query, searchType, maxPages, filters = {}) {
  const provider = await getProviderForRun("linkedin");
  if (!provider?.enabled) throw new Error("unsupported_provider");
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) throw new Error("search_query_required");
  const pageCount = Math.max(1, Math.min(40, Number(maxPages) || 20));
  const byUrl = new Map();
  let lastResultsUrl = "";
  let visitedPages = 0;
  scrapeCancelled = false;

  await persistScrapeState({
    status: "running",
    providerId: provider.id,
    mode: "search",
    phase: "scanning",
    leads: [],
    progress: null,
    error: ""
  });

  for (let page = 1; page <= pageCount; page += 1) {
    if (scrapeCancelled) throw new Error("cancelled");
    reportProgress({
      stage: "scroll",
      phase: "progress",
      found: byUrl.size,
      page,
      maxPages: pageCount,
      message: `Opening result page ${page}/${pageCount}…`
    }, tabId);

    if (page === 1) {
      const currentTab = await chrome.tabs.get(tabId);
      const targetUrl = linkedinSearchUrl(cleanQuery, searchType, 1, currentTab.url);
      const navigation = waitForTabLoad(tabId);
      if (currentTab.url === targetUrl) await chrome.tabs.reload(tabId);
      else await chrome.tabs.update(tabId, { url: targetUrl });
      await navigation;
      await sleep(1400);
      await applyLinkedInFilters(tabId, filters);
    } else {
      const advanced = await clickLinkedInNextPage(tabId, page);
      if (!advanced) break;
      await sleepCancellable(jitteredMs(1800, 0.25));
    }

    let pageResult;
    try {
      pageResult = await scrapeSearchIncremental(tabId, provider);
    } catch (err) {
      if (err instanceof Error && err.message === "no_leads_found" && byUrl.size > 0) break;
      if (err instanceof Error && err.message === "cancelled") throw err;
      throw err;
    }
    visitedPages += 1;
    lastResultsUrl = (await chrome.tabs.get(tabId)).url || lastResultsUrl;
    const before = byUrl.size;
    for (const lead of pageResult.leads || []) {
      const key = lead?.profile_url || lead?.linkedin_url;
      if (key) byUrl.set(key, mergeLeads(byUrl.get(key), lead));
    }
    reportProgress({
      stage: "scroll",
      phase: "progress",
      found: byUrl.size,
      page,
      maxPages: pageCount,
      message: `Page ${page}/${pageCount} done · ${byUrl.size} unique`,
      sample: Array.from(byUrl.values()).slice(-4)
    }, tabId);
    if ((pageResult.leads || []).length === 0 || (page > 1 && byUrl.size === before)) break;
  }

  let leads = Array.from(byUrl.values());
  if (leads.length === 0) throw new Error("no_leads_found");

  const enrichCfg = provider.scrapeSearch || provider.scrape;
  if (enrichCfg?.enrichProfiles) {
    leads = await enrichLinkedInProfiles(tabId, provider, leads, {
      returnUrl: lastResultsUrl,
      pageUrl: lastResultsUrl,
      enrichCfg
    });
  } else {
    await saveListedLeadsAndQueueBackground(provider, leads, lastResultsUrl);
  }

  await persistScrapeState({
    status: "ready",
    providerId: provider.id,
    mode: "search",
    phase: "ready",
    leads,
    progress: null,
    error: ""
  });
  return {
    provider: provider.id,
    leads,
    page_type: "search",
    pages_visited: visitedPages,
    query: cleanQuery,
    search_type: searchType === "people" ? "people" : "companies"
  };
}

async function collectLinkedInConnections(tabId) {
  const provider = await getProviderForRun("linkedin");
  if (!provider?.enabled) throw new Error("unsupported_provider");
  scrapeCancelled = false;
  const targetUrl = provider.entryUrl;
  const currentTab = await chrome.tabs.get(tabId);
  const navigation = waitForTabLoad(tabId);
  if (currentTab.url === targetUrl) await chrome.tabs.reload(tabId);
  else await chrome.tabs.update(tabId, { url: targetUrl });
  await navigation;
  await sleep(1400);
  return scrapeConnectionsIncremental(tabId, provider);
}

async function scrapeListIncremental(tabId, provider, mode) {
  const isSearch = mode === "search";
  const limits = (isSearch ? provider.scrapeSearch : null) || provider.scrape || {};
  const maxRounds = limits.maxRounds ?? (isSearch ? 100 : 120);
  const pauseMs = limits.pauseMs ?? 1000;
  const maxLeads = limits.maxLeads ?? (isSearch ? 800 : 1000);
  const staleLimit = limits.staleLimit ?? (isSearch ? 12 : 10);
  const entity = isSearch ? "results" : "connections";
  const pageType = isSearch ? "search" : "connections";

  await injectCollector(tabId, provider);

  if (provider.api.pageGate) {
    const gate = await runInTab(
      tabId,
      (gateGlobal) => {
        const fn = globalThis[gateGlobal];
        return typeof fn === "function" ? fn() : { ok: true, error: "" };
      },
      [provider.api.pageGate]
    );
    if (gate && gate.ok === false) {
      throw new Error(gate.error || "page_blocked");
    }
  }

  const byUrl = new Map();
  let staleRounds = 0;
  let completedRounds = 0;
  let pageUrl = "";

  reportProgress({
    stage: "scroll",
    phase: "start",
    found: 0,
    round: 0,
    maxRounds,
    message: isSearch ? "Scanning search results…" : "Scanning connection list…"
  }, tabId);

  for (let round = 0; round < maxRounds; round += 1) {
    if (scrapeCancelled) {
      throw new Error("cancelled");
    }
    completedRounds = round + 1;
    const snapshot = await collectSnapshot(tabId, provider, mode);
    pageUrl = snapshot.page_url || pageUrl;
    const before = byUrl.size;

    for (const lead of snapshot.leads || []) {
      const key = lead?.profile_url || lead?.linkedin_url;
      if (!key) continue;
      const existing = byUrl.get(key);
      byUrl.set(key, mergeLeads(existing, lead));
    }

    reportProgress({
      stage: "scroll",
      phase: "progress",
      found: byUrl.size,
      round: round + 1,
      maxRounds,
      message: `Scrolling list… ${byUrl.size} ${entity}`,
      sample: Array.from(byUrl.values()).slice(-4)
    }, tabId);

    if (byUrl.size === before) {
      staleRounds += 1;
      if (staleRounds >= staleLimit) break;
      await sleep(Math.min(pauseMs + staleRounds * 200, 2800));
    } else {
      staleRounds = 0;
    }

    if (byUrl.size >= maxLeads) break;

    await scrollOnce(tabId, provider);
    if (staleRounds === 0) {
      await sleep(pauseMs);
    }
  }

  let leads = Array.from(byUrl.values());

  reportProgress({
    stage: "scroll",
    phase: "done",
    found: leads.length,
    maxRounds,
    round: completedRounds,
    message: `${leads.length} ${entity} listed`
  }, tabId);

  reportProgress({
    stage: "parse",
    phase: "start",
    found: leads.length,
    message: isSearch ? "Merging search result details…" : "Merging connection details…"
  }, tabId);

  for (let pass = 0; pass < 3; pass += 1) {
    if (scrapeCancelled) {
      throw new Error("cancelled");
    }
    const snapshot = await collectSnapshot(tabId, provider, mode);
    for (const lead of snapshot.leads || []) {
      const key = lead?.profile_url || lead?.linkedin_url;
      if (!key) continue;
      byUrl.set(key, mergeLeads(byUrl.get(key), lead));
    }
    reportProgress({
      stage: "parse",
      phase: "progress",
      found: byUrl.size,
      pass: pass + 1,
      message: `Reading details… ${byUrl.size} ${entity}`,
      sample: Array.from(byUrl.values()).slice(-4)
    }, tabId);
    await scrollOnce(tabId, provider);
    await sleep(800);
  }

  leads = Array.from(byUrl.values());
  reportProgress({
    stage: "parse",
    phase: "done",
    found: leads.length,
    message: `${leads.length} ${entity} ready`
  }, tabId);

  if (leads.length === 0) {
    throw new Error(isSearch ? "no_leads_found" : "no_leads_found");
  }

  // Phase 1 done (list). Inline enrich only when explicitly enabled; otherwise
  // save skeletons and queue ban-safe background enrich for later.
  const enrichCfg = isSearch ? provider.scrapeSearch || provider.scrape : provider.scrape;
  if (enrichCfg?.enrichProfiles) {
    leads = await enrichLinkedInProfiles(tabId, provider, leads, {
      returnUrl: pageUrl,
      pageUrl,
      enrichCfg
    });
  } else {
    await saveListedLeadsAndQueueBackground(provider, leads, pageUrl);
  }

  await persistScrapeState({
    status: "ready",
    phase: "ready",
    providerId: provider.id,
    leads,
    progress: null,
    error: ""
  });

  return {
    provider: provider.id,
    leads,
    page_url: pageUrl,
    page_type: pageType,
    scrolled: true,
    total_found: leads.length,
    scroll_rounds: completedRounds
  };
}

async function scrapeProviderTab(tabId, provider, mode = "quick") {
  if (!chrome.scripting?.executeScript) {
    throw new Error("scripting_api_unavailable");
  }
  if (!provider?.enabled) {
    throw new Error("provider_disabled");
  }

  if (mode === "connections" && provider.api.parseConnections) {
    return scrapeConnectionsIncremental(tabId, provider);
  }
  if (mode === "search" && (provider.api.parseSearch || provider.api.collect)) {
    return scrapeSearchIncremental(tabId, provider);
  }

  await injectCollector(tabId, provider);

  if (provider.api.pageGate) {
    const gate = await runInTab(
      tabId,
      (gateGlobal) => {
        const fn = globalThis[gateGlobal];
        return typeof fn === "function" ? fn() : { ok: true, error: "" };
      },
      [provider.api.pageGate]
    );
    if (gate && gate.ok === false) {
      throw new Error(gate.error || "page_blocked");
    }
  }

  const snapshot = await collectSnapshot(tabId, provider, mode);
  if (snapshot.error) {
    throw new Error(snapshot.error);
  }
  if (!snapshot.leads?.length) {
    throw new Error("no_leads_found");
  }
  return snapshot;
}

async function scrapeViaContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "collect-leads" });
    if (!response) {
      throw new Error("content_script_no_response");
    }
    if (response.error) {
      throw new Error(response.error);
    }
    return response;
  } catch {
    throw new Error("content_script_missing");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-scrape-state") {
    loadScrapeState().then(() => sendResponse({ ...scrapeState }));
    return true;
  }

  if (message?.type === "get-bg-enrich-state") {
    loadBgEnrichState().then((state) => sendResponse({ ok: true, state }));
    return true;
  }

  if (message?.type === "schedule-bg-enrich") {
    scheduleBackgroundEnrich({ immediate: Boolean(message.immediate) }).then((result) =>
      sendResponse(result)
    );
    return true;
  }

  if (message?.type === "ensure-bg-enrich") {
    ensureBackgroundEnrichQueued({ force: Boolean(message.force) }).then((result) =>
      sendResponse(result)
    );
    return true;
  }

  if (message?.type === "cancel-bg-enrich") {
    (async () => {
      if (chrome.alarms?.clear) await chrome.alarms.clear(BG_ENRICH_ALARM);
      scrapeCancelled = true;
      const state = await persistBgEnrichState({
        status: "idle",
        message: "Background enrich cancelled"
      });
      sendResponse({ ok: true, state });
    })();
    return true;
  }

  if (message?.type === "run-bg-enrich-tick") {
    runBackgroundEnrichTick().then((result) => sendResponse(result));
    return true;
  }

  if (message?.type === "cancel-scrape") {
    scrapeCancelled = true;
    persistScrapeState({
      status: "error",
      phase: "error",
      error: "cancelled",
      progress: null
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "search-linkedin") {
    (async () => {
      try {
        const tabId = message.tabId || sender?.tab?.id;
        if (!tabId) throw new Error("missing_tab_id");
        const result = await searchLinkedIn(
          tabId,
          message.query,
          message.searchType,
          message.maxPages,
          message.filters || {}
        );
        sendResponse(result);
      } catch (err) {
        const error = err instanceof Error ? err.message : "search_failed";
        await persistScrapeState({ status: "error", phase: "error", error });
        sendResponse({ error });
      }
    })();
    return true;
  }

  if (message?.type === "collect-linkedin-connections") {
    (async () => {
      try {
        const tabId = message.tabId || sender?.tab?.id;
        if (!tabId) throw new Error("missing_tab_id");
        await persistScrapeState({
          status: "running",
          providerId: "linkedin",
          mode: "connections",
          phase: "scanning",
          leads: [],
          progress: null,
          error: ""
        });
        const result = await collectLinkedInConnections(tabId);
        await persistScrapeState({
          status: "ready",
          phase: "ready",
          providerId: "linkedin",
          mode: "connections",
          leads: result?.leads || [],
          progress: null,
          error: ""
        });
        sendResponse(result);
      } catch (err) {
        const error = err instanceof Error ? err.message : "scrape_failed";
        await persistScrapeState({ status: "error", phase: "error", error });
        sendResponse({ error });
      }
    })();
    return true;
  }

  if (message?.type === "clear-scrape-state") {
    scrapeCancelled = false;
    scrapeState = {
      status: "idle",
      providerId: "",
      mode: "",
      phase: "idle",
      leads: [],
      progress: null,
      error: ""
    };
    chrome.storage.session.remove(SCRAPE_STATE_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "send-provider-leads") {
    (async () => {
      try {
        const providerId = message.providerId || "linkedin";
        const result = await sendLeadsToApi({
          providerId,
          leads: Array.isArray(message.leads) ? message.leads : [],
          pageUrl: message.pageUrl || sender?.tab?.url || ""
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : "send_failed" });
      }
    })();
    return true;
  }

  const legacyType = message?.type === "scrape-linkedin-tab";
  const type = message?.type === "scrape-provider-tab" ? "scrape-provider-tab" : legacyType ? "scrape-provider-tab" : null;
  if (!type) {
    return;
  }

  const tabId = message.tabId || sender?.tab?.id;
  const providerId = message.providerId || "linkedin";
  const mode =
    message.mode === "connections" || message.mode === "search" || message.mode === "quick"
      ? message.mode
      : "quick";

  if (!tabId) {
    sendResponse({ error: "missing_tab_id" });
    return;
  }

  (async () => {
    const provider = await getProviderForRun(providerId);
    if (!provider?.enabled) {
      sendResponse({ error: "unsupported_provider" });
      return;
    }
    scrapeCancelled = false;
    await persistScrapeState({
      status: "running",
      providerId,
      mode,
      phase: "scanning",
      leads: [],
      progress: null,
      error: ""
    });

    try {
      let result;
      if (chrome.scripting?.executeScript) {
        result = await scrapeProviderTab(tabId, provider, mode);
      } else {
        result = await scrapeViaContentScript(tabId);
      }
      if (scrapeCancelled) {
        throw new Error("cancelled");
      }
      await persistScrapeState({
        status: "ready",
        phase: "ready",
        providerId,
        mode,
        leads: result?.leads || [],
        progress: null,
        error: ""
      });
      sendResponse(result);
    } catch (err) {
      const primary = err instanceof Error ? err.message : "scrape_failed";
      if (primary === "cancelled") {
        await persistScrapeState({
          status: "error",
          phase: "error",
          providerId,
          mode,
          error: "cancelled"
        });
        sendResponse({ error: "cancelled" });
        return;
      }
      try {
        const result = await scrapeViaContentScript(tabId);
        await persistScrapeState({
          status: "ready",
          phase: "ready",
          providerId,
          mode,
          leads: result?.leads || [],
          progress: null,
          error: ""
        });
        sendResponse(result);
      } catch (fallbackErr) {
        const fallback = fallbackErr instanceof Error ? fallbackErr.message : "scrape_failed";
        await persistScrapeState({
          status: "error",
          phase: "error",
          providerId,
          mode,
          error: primary
        });
        sendResponse({ error: primary, fallback });
      }
    }
  })();

  return true;
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== BG_ENRICH_ALARM) return;
    void runBackgroundEnrichTick();
  });
}

void loadScrapeState();
