const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load background.js in a minimal fake MV3 environment and expose its message listener.
function loadBackground({ executeScript } = {}) {
  let onMessage = null;
  const session = {};
  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (onMessage = fn) },
      sendMessage: () => Promise.resolve()
    },
    storage: {
      session: {
        set: async (obj) => Object.assign(session, obj),
        get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, session[k]])),
        remove: async (k) => delete session[k]
      },
      local: { get: async () => ({}), set: async () => {} },
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    tabs: { onUpdated: { addListener() {}, removeListener() {} }, sendMessage: () => Promise.resolve() },
    scripting: { executeScript: executeScript || (async () => [{ result: undefined }]) }
  };
  // Scan pauses run instantly.
  const fastTimeout = (fn) => setTimeout(fn, 0);
  const context = { chrome, console, setTimeout: fastTimeout, clearTimeout, URL, Map, Set, Promise, JSON, Date, Math };
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "background.js"), "utf8"), context);
  const send = (message) => new Promise((resolve) => onMessage(message, {}, resolve));
  return { context, send };
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
