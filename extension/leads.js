const ext = globalThis.chrome ?? globalThis.browser;
const cfg = globalThis.LI_IMPORT_CONFIG || {};
const STORAGE_PREFIX = cfg.storagePrefix || "dgmos_";
const BRAND_NAME = cfg.brandName || "Dgmos";
const DEFAULT_API_BASE = cfg.defaultApiBase || "http://localhost:8088";
const resolveFeatures =
  typeof globalThis.liImportResolveFeatures === "function"
    ? globalThis.liImportResolveFeatures
    : () => ({ aiEnabled: false, enrichEnabled: false });

let features = resolveFeatures(cfg, null);

const els = {
  searchInput: document.getElementById("searchInput"),
  leadList: document.getElementById("leadList"),
  statusLine: document.getElementById("statusLine"),
  loadMoreBtn: document.getElementById("loadMoreBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  statAll: document.getElementById("statAll"),
  statListed: document.getElementById("statListed"),
  statEnriched: document.getElementById("statEnriched"),
  statAiDone: document.getElementById("statAiDone"),
  bgEnrichLine: document.getElementById("bgEnrichLine"),
  bgEnrichTitle: document.getElementById("bgEnrichTitle"),
  bgEnrichCard: document.getElementById("bgEnrichCard"),
  pipelineJourney: document.getElementById("pipelineJourney"),
  queueEnrichBtn: document.getElementById("queueEnrichBtn"),
  runEnrichTickBtn: document.getElementById("runEnrichTickBtn")
};

let apiBase = DEFAULT_API_BASE;
let token = "";
let filter = "all";
let cursor = "";
let loading = false;
let searchTimer = null;
let pollTimer = null;
let lastBgState = { status: "idle", message: "" };
let lastTotals = {};
let cachedItems = [];

function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeProfileUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .split("?")[0]
    .split("#")[0];
}

function uniqMeta(lead) {
  const name = String(lead?.name || "").trim().toLowerCase();
  const parts = [lead.title, lead.company, lead.location, lead.email, lead.website]
    .map((v) => String(v || "").trim())
    .filter((v) => v && v.toLowerCase() !== name);
  return parts.join(" · ");
}

/** Per-row pipeline: waiting → queued → in progress → done */
function pipelineStatus(lead, bg = lastBgState) {
  if (lead?.enrich_status === "enriched") {
    return { key: "done", label: "Done", cls: "done" };
  }

  const leadUrl = normalizeProfileUrl(lead?.profile_url || lead?.linkedin_url);
  const currentUrl = normalizeProfileUrl(bg?.currentUrl);
  const busy = bg?.status === "running" || bg?.status === "scheduled";

  if (busy && leadUrl && currentUrl && leadUrl === currentUrl) {
    return { key: "enriching", label: "In progress", cls: "enriching" };
  }
  if (busy || bg?.phase === "queued" || bg?.phase === "enriching") {
    return { key: "queued", label: "Queued", cls: "queued" };
  }
  return { key: "waiting", label: "Waiting", cls: "waiting" };
}

function enrichBadge(lead) {
  const status = pipelineStatus(lead);
  return `<span class="badge ${status.cls}">${status.label}</span>`;
}

function aiBadge(status) {
  const map = {
    none: ["ai-none", "AI none"],
    pending: ["ai-pending", "AI pending"],
    done: ["ai-done", "AI done"],
    skipped: ["ai-skipped", "AI skipped"]
  };
  const [cls, label] = map[status] || map.none;
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderTotals(totals = {}) {
  lastTotals = totals || {};
  els.statAll.textContent = totals.all ?? 0;
  els.statListed.textContent = totals.listed ?? 0;
  els.statEnriched.textContent = totals.enriched ?? 0;
  els.statAiDone.textContent = totals.ai_done ?? 0;
  document.getElementById("statAiDone")?.closest(".stat")?.classList.toggle("hidden", !features.aiEnabled);
}

function updatePipelineJourney(bg = lastBgState, totals = {}) {
  if (!els.pipelineJourney) return;
  const listed = Number(totals.listed ?? 0);
  const enriched = Number(totals.enriched ?? 0);
  const status = bg?.status || "idle";

  let active = "saved";
  if (status === "done" && listed === 0 && enriched > 0) active = "done";
  else if (status === "running" || bg?.phase === "enriching") active = "enriching";
  else if (status === "scheduled" || bg?.phase === "queued" || listed > 0) active = "queued";
  else if (enriched > 0 || listed > 0) active = "saved";

  const order = ["saved", "queued", "enriching", "done"];
  const activeIdx = order.indexOf(active);

  els.pipelineJourney.querySelectorAll("[data-phase]").forEach((el) => {
    const phase = el.getAttribute("data-phase");
    const idx = order.indexOf(phase);
    el.classList.toggle("is-active", phase === active);
    el.classList.toggle("is-complete", idx >= 0 && idx < activeIdx);
  });
}

function renderItems(items, append) {
  if (!append) {
    cachedItems = items || [];
    els.leadList.innerHTML = "";
  } else {
    cachedItems = cachedItems.concat(items || []);
  }
  const html = (items || [])
    .map((lead) => {
      const meta = uniqMeta(lead);
      const about = String(lead.about || "").trim();
      const aboutBit = about ? escapeHtml(about.slice(0, 140)) + (about.length > 140 ? "…" : "") : "";
      const url = lead.profile_url || lead.linkedin_url || "#";
      const pipe = pipelineStatus(lead);
      return `<li class="lead-item" data-pipeline="${pipe.key}">
        <div>
          <p class="lead-name"><a class="lead-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(lead.name || "Untitled")}</a></p>
          <p class="lead-meta">${escapeHtml(meta)}${meta && aboutBit ? "<br>" : ""}${aboutBit}</p>
        </div>
        <div class="badges">
          ${enrichBadge(lead)}
          ${features.aiEnabled ? aiBadge(lead.ai_status) : ""}
        </div>
      </li>`;
    })
    .join("");
  els.leadList.insertAdjacentHTML("beforeend", html);
}

/** Re-stamp badges without refetch when only bg currentUrl changed. */
function restampPipelineBadges() {
  const rows = els.leadList.querySelectorAll(".lead-item");
  rows.forEach((row, i) => {
    const lead = cachedItems[i];
    if (!lead) return;
    const pipe = pipelineStatus(lead);
    row.setAttribute("data-pipeline", pipe.key);
    const badge = row.querySelector(".badges .badge:first-child");
    if (badge) {
      badge.className = `badge ${pipe.cls}`;
      badge.textContent = pipe.label;
    }
  });
}

function filterParams() {
  const params = new URLSearchParams();
  params.set("limit", "40");
  if (cursor) params.set("cursor", cursor);
  const q = (els.searchInput.value || "").trim();
  if (q) params.set("q", q);
  if (filter === "listed" || filter === "enriched") params.set("enrich_status", filter);
  if (filter === "ai_done") params.set("ai_status", "done");
  if (filter === "ai_pending") params.set("ai_status", "pending");
  return params;
}

function humanBgTitle(bg) {
  const status = bg?.status || "idle";
  if (status === "running") return "Detail enrich · In progress";
  if (status === "scheduled") return "Detail enrich · Queued";
  if (status === "done") return "Detail enrich · Done";
  if (status === "paused") return "Detail enrich · Paused";
  return "Detail enrich";
}

function humanBgLine(bg) {
  if (features.backgroundEnrichEnabled === false) {
    return "Background detail visits are off in config.";
  }
  const status = bg?.status || "idle";
  const when = bg?.nextRunAt ? new Date(bg.nextRunAt).toLocaleTimeString() : "";
  const bits = [];

  if (status === "running") {
    bits.push(bg.currentName ? `Now: ${bg.currentName}` : "Visiting profiles…");
    if (bg.tickIndex && bg.tickTotal) bits.push(`${bg.tickIndex}/${bg.tickTotal} this batch`);
    bits.push("no click needed — leave Chrome open");
  } else if (status === "scheduled") {
    bits.push(when ? `Next visit ~${when}` : "Waiting for next batch");
    bits.push("no click needed");
  } else if (status === "done") {
    bits.push("All waiting leads finished");
  } else if (status === "paused") {
    bits.push("Paused — will retry");
  }

  if (bg.remaining != null && bg.remaining > 0) bits.push(`${bg.remaining} still waiting`);
  if (bg.message && status !== "running") bits.push(bg.message);
  else if (bg.message && status === "running" && !bg.currentName) bits.push(bg.message);

  return bits.filter(Boolean).join(" · ") || "Idle — save leads from LinkedIn to start the queue.";
}

function syncPollTimer(bg = lastBgState) {
  const shouldPoll = bg?.status === "running" || bg?.status === "scheduled";
  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(() => {
      void refreshBgEnrichLine({ softReload: true });
    }, 4000);
  } else if (!shouldPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshBgEnrichLine({ softReload = false } = {}) {
  if (!els.bgEnrichLine) return;
  try {
    const res = await ext.runtime.sendMessage({ type: "get-bg-enrich-state" });
    const prevUrl = lastBgState?.currentUrl;
    const prevStatus = lastBgState?.status;
    lastBgState = res?.state || {};
    if (els.bgEnrichTitle) els.bgEnrichTitle.textContent = humanBgTitle(lastBgState);
    els.bgEnrichLine.textContent = humanBgLine(lastBgState);
    els.bgEnrichCard?.setAttribute("data-status", lastBgState.status || "idle");
    updatePipelineJourney(lastBgState, lastTotals);

    if (softReload && lastBgState.status === "running") {
      restampPipelineBadges();
      if (prevUrl !== lastBgState.currentUrl || prevStatus !== lastBgState.status) {
        // Refresh counts / done badges after each profile finishes.
        if (prevUrl && prevUrl !== lastBgState.currentUrl) {
          void fetchLeads({ append: false, quiet: true });
        }
      }
    } else if (softReload && prevStatus === "running" && lastBgState.status !== "running") {
      void fetchLeads({ append: false, quiet: true });
    } else {
      restampPipelineBadges();
    }
    syncPollTimer(lastBgState);
  } catch {
    els.bgEnrichLine.textContent = "Could not read queue status.";
  }
}

async function loadSettings() {
  const stored = await ext.storage.sync.get([
    storageKey("apiBase"),
    storageKey("token"),
    storageKey("features"),
    "apiBase",
    "token",
    "features"
  ]);
  apiBase = (stored[storageKey("apiBase")] || stored.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  token = (stored[storageKey("token")] || stored.token || "").trim();
  features = resolveFeatures(cfg, stored[storageKey("features")] || stored.features || null);
  applyFeatureUi();
}

function applyFeatureUi() {
  document.querySelectorAll('[data-filter="ai_done"], [data-filter="ai_pending"]').forEach((el) => {
    el.classList.toggle("hidden", !features.aiEnabled);
  });
  document.getElementById("statAiDone")?.closest(".stat")?.classList.toggle("hidden", !features.aiEnabled);
  if (!features.aiEnabled && (filter === "ai_done" || filter === "ai_pending")) {
    filter = "all";
    document.querySelectorAll(".chip").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-filter") === "all");
    });
  }
}

async function fetchLeads({ append = false, quiet = false } = {}) {
  if (loading) return;
  if (!token) {
    els.statusLine.textContent = "Connect the extension with a token first, then reopen this page.";
    return;
  }
  loading = true;
  els.loadMoreBtn.disabled = true;
  if (!quiet) els.statusLine.textContent = append ? "Loading more…" : "Loading saved leads…";
  try {
    const res = await fetch(`${apiBase}/v1/leads?${filterParams().toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    renderTotals(body.totals || {});
    renderItems(body.items || [], append);
    cursor = body.next_cursor || "";
    els.loadMoreBtn.classList.toggle("hidden", !cursor);
    updatePipelineJourney(lastBgState, body.totals || {});
    const count = els.leadList.children.length;
    if (!quiet) {
      els.statusLine.textContent = count
        ? `Showing ${count}${cursor ? "+" : ""} · each row shows Waiting / Queued / In progress / Done.`
        : "No saved leads for this filter yet. Import from LinkedIn first.";
    }
    void refreshBgEnrichLine();
  } catch (err) {
    if (!quiet) els.statusLine.textContent = err instanceof Error ? err.message : "Failed to load leads";
  } finally {
    loading = false;
    els.loadMoreBtn.disabled = false;
  }
}

function resetAndLoad() {
  cursor = "";
  void fetchLeads({ append: false });
}

document.querySelectorAll("[data-brand]").forEach((el) => {
  el.textContent = BRAND_NAME;
});
document.title = `${BRAND_NAME} · Saved leads`;

els.refreshBtn.addEventListener("click", () => {
  resetAndLoad();
  void refreshBgEnrichLine();
});
els.loadMoreBtn.addEventListener("click", () => void fetchLeads({ append: true }));
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => resetAndLoad(), 280);
});
document.querySelector(".filters")?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-filter]");
  if (!btn) return;
  filter = btn.getAttribute("data-filter") || "all";
  document.querySelectorAll(".chip").forEach((el) => el.classList.toggle("active", el === btn));
  resetAndLoad();
});
els.queueEnrichBtn?.addEventListener("click", async () => {
  els.bgEnrichLine.textContent = "Putting waiting leads into the queue…";
  try {
    await ext.runtime.sendMessage({ type: "ensure-bg-enrich", force: true });
  } catch {
    // ignore
  }
  void refreshBgEnrichLine();
  restampPipelineBadges();
});
els.runEnrichTickBtn?.addEventListener("click", async () => {
  els.bgEnrichLine.textContent = "Starting next batch now…";
  try {
    await ext.runtime.sendMessage({ type: "run-bg-enrich-tick" });
  } catch (err) {
    els.bgEnrichLine.textContent = err instanceof Error ? err.message : "Batch failed";
  }
  void refreshBgEnrichLine();
  resetAndLoad();
});

void (async () => {
  await loadSettings();
  resetAndLoad();
  try {
    await ext.runtime.sendMessage({ type: "ensure-bg-enrich" });
  } catch {
    // ignore
  }
  void refreshBgEnrichLine();
})();
