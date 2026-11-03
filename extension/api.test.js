const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, "api.js"), "utf8");
  // Backoff sleeps run instantly; the 30s request timeout never fires.
  const setTimeout = (fn, ms) => {
    if (ms < 30000) fn();
    return 1;
  };
  const sandbox = { globalThis: {}, fetch: fetchImpl, JSON, String, Number, Set, setTimeout, clearTimeout() {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.globalThis.DgmosApi;
}

const BASE = "https://sandbox.dgmos.com/api";

test("resolveApiBase drops legacy sidecar URLs", () => {
  const api = loadApi(() => {});
  assert.equal(api.resolveApiBase("http://localhost:8088", BASE), BASE);
  assert.equal(api.resolveApiBase("https://capture.example.com/v1", BASE), BASE);
  assert.equal(api.resolveApiBase("", BASE), BASE);
  assert.equal(api.resolveApiBase("http://localhost:8080/api/", BASE), "http://localhost:8080/api");
});

test("request posts JSON with Bearer access key to the module endpoint", async () => {
  let seen;
  const api = loadApi(async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ created: 1 }) };
  });
  const result = await api.request(`${BASE}/`, "dg_ak_pub_x", "importLeads", { leads: [] });
  assert.equal(seen.url, `${BASE}/modules/lead-capture`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer dg_ak_pub_x");
  assert.equal(seen.init.body, JSON.stringify({ leads: [] }));
  assert.equal(result.body.created, 1);
});

test("errorMessage maps backend errors", async () => {
  const api = loadApi(() => {});
  assert.equal(api.errorMessage({ status: 401, body: {} }), "unauthorized");
  assert.equal(api.errorMessage({ status: 400, body: { error: "maximum_100_leads" } }), "maximum_100_leads");
  assert.equal(api.errorMessage({ status: 500, body: { message: "db down" } }), "server_error");
  assert.equal(api.errorMessage({ status: 500, body: { error: "db_error" } }), "db_error");
  const failing = loadApi(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(failing.request(BASE, "k", "session"), /network/);
});

function fakeResponse(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body
  };
}

test("request retries rate limits and gateway errors, then succeeds", async () => {
  const statuses = [429, 503, 200];
  let calls = 0;
  const api = loadApi(async () => fakeResponse(statuses[calls++], { created: 2 }));
  const result = await api.request(BASE, "k", "importLeads", { leads: [] });
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.body.created, 2);
});

test("request gives up after retries and reports rate_limited, not unauthorized", async () => {
  let calls = 0;
  const api = loadApi(async () => {
    calls += 1;
    return fakeResponse(429, {}, { "Retry-After": "2" });
  });
  const result = await api.request(BASE, "k", "importLeads", {});
  assert.equal(calls, 4);
  assert.equal(api.errorMessage(result), "rate_limited");
});

test("request does not retry auth or permission errors", async () => {
  let calls = 0;
  const api = loadApi(async () => {
    calls += 1;
    return fakeResponse(400, { error: "permission_denied" });
  });
  const result = await api.request(BASE, "k", "session");
  assert.equal(calls, 1);
  assert.equal(api.errorMessage(result), "permission_denied");
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (obj) => Object.assign(data, obj),
    remove: async (keys) => keys.forEach((k) => delete data[k])
  };
}

test("loadAuth moves a key left in sync storage to local storage once", async () => {
  const api = loadApi(() => {});
  const ext = {
    storage: {
      local: fakeStorage(),
      sync: fakeStorage({ dgmos_token: " dg_ak_pub_old ", dgmos_apiBase: BASE, dgmos_panelSeen: true })
    }
  };
  const auth = await api.loadAuth(ext);
  assert.equal(auth.token, "dg_ak_pub_old");
  assert.equal(auth.apiBase, BASE);
  assert.equal(ext.storage.local.data.dgmos_token, "dg_ak_pub_old");
  assert.equal("dgmos_token" in ext.storage.sync.data, false, "key must leave sync storage");
  assert.equal(ext.storage.sync.data.dgmos_panelSeen, true, "other sync prefs stay");

  await api.saveAuth(ext, { token: "", apiBase: BASE });
  assert.equal((await api.loadAuth(ext)).token, "");
});
