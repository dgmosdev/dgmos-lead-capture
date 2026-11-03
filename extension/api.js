// Dgmos backend client shared by popup, leads page, background worker and content script.
// Endpoints live under the backend API base (e.g. https://sandbox.dgmos.com/api).
(function registerDgmosApi() {
  const ENDPOINTS = {
    session: "/modules/lead-capture-session",
    importLeads: "/modules/lead-capture",
    listLeads: "/modules/list-lead-capture"
  };

  const STORAGE_PREFIX = (globalThis.LI_IMPORT_CONFIG || {}).storagePrefix || "dgmos_";
  const TOKEN_KEY = `${STORAGE_PREFIX}token`;
  const API_BASE_KEY = `${STORAGE_PREFIX}apiBase`;

  const REQUEST_TIMEOUT_MS = 30000;
  // All endpoints are idempotent (import is an upsert keyed by profile URL), so retrying is safe.
  const RETRY_STATUSES = new Set([429, 502, 503, 504]);
  const RETRY_DELAYS_MS = [1000, 3000, 7000];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function retryDelay(res, attempt) {
    const header = Number(res?.headers?.get?.("Retry-After"));
    if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30000);
    return RETRY_DELAYS_MS[attempt];
  }

  async function fetchOnce(url, init) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * POST JSON to a Dgmos endpoint with the Dgmos access key as Bearer token.
   * Retries rate limits, gateway errors and network failures with backoff.
   * Resolves to { ok, status, body }; persistent network failure rejects with Error("network").
   */
  async function request(apiBase, token, endpoint, payload = {}) {
    const path = ENDPOINTS[endpoint];
    if (!path) throw new Error(`unknown_endpoint:${endpoint}`);
    const url = `${String(apiBase || "").replace(/\/$/, "")}${path}`;
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    };

    for (let attempt = 0; ; attempt += 1) {
      const canRetry = attempt < RETRY_DELAYS_MS.length;
      let res;
      try {
        res = await fetchOnce(url, init);
      } catch {
        if (!canRetry) throw new Error("network");
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (RETRY_STATUSES.has(res.status) && canRetry) {
        await sleep(retryDelay(res, attempt));
        continue;
      }
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    }
  }

  /** Backend error shape: { status, error, message }. */
  function errorMessage(result) {
    const body = result?.body || {};
    if (result?.status === 401) return "unauthorized";
    if (result?.status === 429) return "rate_limited";
    if (result?.status >= 500 && !body.error) return "server_error";
    return body.error || body.message || `HTTP ${result?.status ?? "?"}`;
  }

  /**
   * Pick the stored API base unless it points at the removed lead-capture sidecar (:8088, /v1).
   */
  function resolveApiBase(stored, fallback) {
    const value = String(stored || "").trim().replace(/\/$/, "");
    if (!value || /:8088$/.test(value) || /\/v1$/.test(value)) return fallback;
    return value;
  }

  /**
   * Save the access key on this device only (storage.local); it must not sync to other browsers.
   */
  async function saveAuth(ext, { token, apiBase }) {
    await ext.storage.local.set({
      [TOKEN_KEY]: String(token || "").trim(),
      [API_BASE_KEY]: String(apiBase || "").trim()
    });
    try {
      await ext.storage.sync.remove([TOKEN_KEY, API_BASE_KEY, "token", "apiBase"]);
    } catch {
      // sync storage unavailable (e.g. policy-disabled) — nothing to clean up
    }
  }

  /**
   * Read the access key; moves a key left in storage.sync by ≤2.0.0 builds to storage.local once.
   */
  async function loadAuth(ext) {
    const local = await ext.storage.local.get([TOKEN_KEY, API_BASE_KEY]);
    const token = String(local[TOKEN_KEY] || "").trim();
    if (token) return { token, apiBase: local[API_BASE_KEY] || "" };

    let legacy = {};
    try {
      legacy = await ext.storage.sync.get([TOKEN_KEY, API_BASE_KEY, "token", "apiBase"]);
    } catch {
      legacy = {};
    }
    const legacyToken = String(legacy[TOKEN_KEY] || legacy.token || "").trim();
    const apiBase = local[API_BASE_KEY] || legacy[API_BASE_KEY] || legacy.apiBase || "";
    if (legacyToken) await saveAuth(ext, { token: legacyToken, apiBase });
    return { token: legacyToken, apiBase };
  }

  globalThis.DgmosApi = { ENDPOINTS, request, errorMessage, resolveApiBase, loadAuth, saveAuth };
})();
