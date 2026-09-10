const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadConfig() {
  const source = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.globalThis.LI_IMPORT_CONFIG;
}

test("LI_IMPORT_CONFIG exposes required white-label fields", () => {
  const cfg = loadConfig();
  assert.ok(cfg.brandName);
  assert.ok(cfg.tokenPrefix);
  assert.ok(cfg.defaultApiBase);
  assert.ok(cfg.prodApiBase);
  assert.ok(cfg.storagePrefix);
  assert.ok(cfg.panelHostId);
  assert.equal(cfg.limits.batch, 100);
  assert.equal(cfg.limits.connections, 2500);
  assert.equal(cfg.limits.search, 800);
  assert.equal(cfg.enrichProfiles, true);
  assert.ok(cfg.enrichPauseMs > 0);
  assert.ok(cfg.tagline);
  assert.ok(!/AI score/i.test(cfg.tagline));
});
