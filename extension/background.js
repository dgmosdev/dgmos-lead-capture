importScripts("config.js", "providers/registry.js");

const SCRAPE_STATE_KEY = "scrapeState";
const DEFAULT_API_BASE = "http://localhost:8088";
const BATCH_SIZE = 100;

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
    chrome.runtime.sendMessage({ type: "scrape-progress", providerId: scrapeState.providerId, ...payload });
  } catch {
    // popup may be closed
  }
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: "scrape-progress", providerId: scrapeState.providerId, ...payload }).catch(() => {
      // content panel may not be mounted on this tab
    });
  }
}

function getProvider(providerId) {
  return globalThis.custfindProviderRegistry?.getProvider(providerId) || null;
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

async function loadExtensionAuth() {
  const stored = await chrome.storage.sync.get(["apiBase", "token"]);
  return {
    apiBase: normalizeApiBase(stored.apiBase),
    token: (stored.token || "").trim()
  };
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
    const res = await fetch(`${apiBase}/extension/leads`, {
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
      const registry = globalThis.custfindProviderRegistry;
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

async function enrichLinkedInProfiles(_sourceTabId, provider, leads) {
  // Keep connection imports list-only; opening each profile automatically increases account risk.
  if (provider?.scrape?.enrichProfiles) {
    reportProgress({
      stage: "parse",
      phase: "done",
      found: leads.length,
      message: `${leads.length} connections prepared from the list; profile pages were not opened`
    }, _sourceTabId);
  }
  return leads;
}

async function scrapeConnectionsIncremental(tabId, provider) {
  return scrapeListIncremental(tabId, provider, "connections");
}

async function scrapeSearchIncremental(tabId, provider) {
  return scrapeListIncremental(tabId, provider, "search");
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

  if (!isSearch) {
    leads = await enrichLinkedInProfiles(tabId, provider, leads);
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

  if (message?.type === "clear-scrape-state") {
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
  const provider = getProvider(providerId);

  if (!tabId) {
    sendResponse({ error: "missing_tab_id" });
    return;
  }
  if (!provider) {
    sendResponse({ error: "unsupported_provider" });
    return;
  }

  (async () => {
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
        const primary = err instanceof Error ? err.message : "scrape_failed";
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

void loadScrapeState();
