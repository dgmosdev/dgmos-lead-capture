const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load background.js in a minimal fake MV3 environment and expose its message listener.
function loadBackground({ executeScript, fetch, local: localInit = {}, alarms } = {}) {
  let onMessage = null;
  const lifecycle = [];
  const session = {};
  const local = { ...localInit };
  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (onMessage = fn) },
      onInstalled: { addListener: (fn) => lifecycle.push(fn) },
      onStartup: { addListener: (fn) => lifecycle.push(fn) },
      sendMessage: () => Promise.resolve()
    },
    alarms,
    storage: {
      session: {
        set: async (obj) => Object.assign(session, obj),
        get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, session[k]])),
        remove: async (k) => delete session[k]
      },
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, local[k]])),
        set: async (obj) => Object.assign(local, obj)
      },
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    tabs: { onUpdated: { addListener() {}, removeListener() {} }, sendMessage: () => Promise.resolve() },
    scripting: { executeScript: executeScript || (async () => [{ result: undefined }]) }
  };
  // Scan pauses run instantly.
  const fastTimeout = (fn) => setTimeout(fn, 0);
  const context = { chrome, console, fetch, setTimeout: fastTimeout, clearTimeout, URL, Map, Set, Promise, JSON, Date, Math };
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "background.js"), "utf8"), context);
  const send = (message) => new Promise((resolve) => onMessage(message, {}, resolve));
  return { context, send, local, lifecycle };
}

const ada = { name: "Ada", profile_url: "https://www.linkedin.com/in/ada" };
const grace = { name: "Grace", profile_url: "https://www.linkedin.com/in/grace" };

test("cancelled scan with collected leads ends ready and returns the leads", async () => {
  const { context, send } = loadBackground();
  const response = await context.finishCancelledScan(context.cancelledWith([ada, grace]), {
    providerId: "linkedin",
    mode: "search"
  });
  assert.equal(response.cancelled, true);
  assert.equal(response.leads.length, 2);
  const state = await send({ type: "get-scrape-state" });
  assert.equal(state.status, "ready");
  assert.equal(state.leads.length, 2);
});

test("cancelled scan with nothing collected stays a cancelled error", async () => {
  const { context } = loadBackground();
  const response = await context.finishCancelledScan(context.cancelledWith([]), { mode: "search" });
  assert.equal(response.error, "cancelled");
});

test("inner cancel leads merge with already collected pages", () => {
  const { context } = loadBackground();
  const byUrl = new Map([[ada.profile_url, ada]]);
  const merged = context.mergeCancelledLeads(byUrl, context.cancelledWith([grace, { ...ada, title: "CTO" }]));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((l) => l.name === "Ada").title, "CTO");
});

test("cancel during a running scan does not wipe state before the scan reports its leads", async () => {
  const { context, send } = loadBackground();
  await context.persistScrapeState({ status: "running", phase: "scanning", providerId: "linkedin", leads: [] });
  await send({ type: "cancel-scrape" });
  const state = await send({ type: "get-scrape-state" });
  assert.equal(state.status, "running", "scan finishes itself and keeps its leads");
  assert.match(state.progress.message, /keeping collected leads/);

  await context.persistScrapeState({ status: "idle", phase: "idle" });
  await send({ type: "cancel-scrape" });
  assert.equal((await send({ type: "get-scrape-state" })).error, "cancelled");
});

test("cancelling a list scan mid-way keeps every profile collected so far", async () => {
  const pool = ["a", "b", "c", "d", "e", "f"].map((slug) => ({
    name: slug.toUpperCase(),
    profile_url: `https://www.linkedin.com/in/${slug}`
  }));
  let snapshots = 0;
  let env;
  env = loadBackground({
    executeScript: async ({ args = [] }) => {
      if (args.length === 2) {
        // collectSnapshot(providerId, mode): each scroll reveals two more profiles
        snapshots += 1;
        if (snapshots === 2) await env.send({ type: "cancel-scrape" });
        return [{ result: { leads: pool.slice(0, snapshots * 2), page_url: "https://www.linkedin.com/search/results/people/" } }];
      }
      return [{ result: { ok: true, error: "" } }];
    }
  });
  const provider = await env.context.getProviderForRun("linkedin");
  await assert.rejects(env.context.scrapeListIncremental(1, provider, "search"), (err) => {
    assert.equal(err.message, "cancelled");
    assert.deepEqual(
      Array.from(err.leads, (l) => l.name),
      ["A", "B", "C", "D"],
      "profiles from both scroll rounds survive the cancel"
    );
    return true;
  });
});

test("enrich attempts: failures count up, success clears, unvisited leads are untouched", () => {
  const { context } = loadBackground();
  const failures = { "https://www.linkedin.com/in/a": 2, "https://www.linkedin.com/in/c": 1 };
  const result = context.recordEnrichAttempts(
    failures,
    ["https://www.linkedin.com/in/a", "https://www.linkedin.com/in/b"],
    new Set(["https://www.linkedin.com/in/b"])
  );
  assert.equal(result["https://www.linkedin.com/in/a"], 3, "visited but not enriched");
  assert.equal("https://www.linkedin.com/in/b" in result, false, "enriched clears");
  assert.equal(result["https://www.linkedin.com/in/c"], 1, "not visited this round");
});

test("background tick skips profiles that already failed 3 times instead of stalling", async () => {
  const stuck = "https://www.linkedin.com/in/stuck";
  const env = loadBackground({
    local: { dgmos_token: "dg_ak_pub_x", dgmos_enrichFailures: { [stuck]: 3 } },
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        items: [{ id: 1, name: "Stuck", profile_url: stuck, enrich_status: "listed" }],
        next_cursor: "",
        totals: { listed: 1 }
      })
    })
  });
  const result = await env.context.runBackgroundEnrichTick();
  assert.equal(result.stuck, 1);
  const state = env.local.dgmos_bgEnrich;
  assert.equal(state.status, "done");
  assert.match(state.message, /could not be opened after 3 tries/);
});

test("runtime features use the extension config, with or without saved session features", async () => {
  for (const saved of [undefined, { ai: false, ai_provider: null }]) {
    const env = loadBackground();
    if (saved) env.context.chrome.storage.sync.get = async () => ({ dgmos_features: saved });
    const features = await env.context.resolveRuntimeFeatures();
    assert.equal(features.backgroundEnrichEnabled, true, "listed leads are queued for detail visits");
    assert.equal(features.enrichEnabled, false, "no inline enrich during the scan");
  }
});

function fakeAlarms() {
  const created = new Map();
  return {
    created,
    get: async (name) => created.get(name),
    clear: async (name) => created.delete(name),
    create: (name, info) => created.set(name, { name, ...info }),
    onAlarm: { addListener() {} }
  };
}

function listedFetch(listed) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ items: [], next_cursor: "", totals: { listed } })
  });
}

test("a 'scheduled' state whose alarm was cleared (extension reload) is re-armed", async () => {
  const alarms = fakeAlarms();
  const env = loadBackground({
    alarms,
    fetch: listedFetch(5),
    local: {
      dgmos_token: "dg_ak_pub_x",
      dgmos_bgEnrich: { status: "scheduled", nextRunAt: 1, updatedAt: Date.now() }
    }
  });
  const result = await env.context.ensureBackgroundEnrichQueued();
  assert.notEqual(result.already, true, "stale schedule must not block");
  assert.ok(alarms.created.has("li-import-bg-enrich"), "alarm re-created");
});

test("a live schedule (alarm present) is left alone", async () => {
  const alarms = fakeAlarms();
  alarms.create("li-import-bg-enrich", { when: Date.now() + 60000 });
  const env = loadBackground({
    alarms,
    fetch: listedFetch(5),
    local: { dgmos_token: "dg_ak_pub_x", dgmos_bgEnrich: { status: "scheduled", updatedAt: Date.now() } }
  });
  const result = await env.context.ensureBackgroundEnrichQueued();
  assert.equal(result.already, true);
});

test("a 'running' state left by a killed worker is treated as stale after 10 minutes", async () => {
  const env = loadBackground({ alarms: fakeAlarms() });
  assert.equal(await env.context.isBgEnrichActive({ status: "running", updatedAt: Date.now() }), true);
  assert.equal(
    await env.context.isBgEnrichActive({ status: "running", updatedAt: Date.now() - 11 * 60 * 1000 }),
    false
  );
});

test("daily limit pauses the queue until the next reset instead of polling every 2 minutes", async () => {
  const alarms = fakeAlarms();
  const day = new Date().toISOString().slice(0, 10);
  let fetched = false;
  const env = loadBackground({
    alarms,
    fetch: async () => {
      fetched = true;
      throw new Error("must not fetch at the daily limit");
    },
    local: { dgmos_token: "dg_ak_pub_x", [`dgmos_enrich_day_${day}`]: 120 }
  });
  const result = await env.context.runBackgroundEnrichTick();
  assert.equal(result.dailyLimit, true);
  assert.equal(fetched, false);
  const alarm = alarms.created.get("li-import-bg-enrich");
  assert.equal(alarm.when, env.context.nextDailyResetAt());
  assert.match(env.local.dgmos_bgEnrich.message, /Daily limit reached \(120/);
});

test("install/update and browser start re-arm the queue", () => {
  const env = loadBackground({ alarms: fakeAlarms() });
  assert.equal(env.lifecycle.length, 2);
});
