const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadConfigSandbox() {
  const source = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.globalThis;
}

test("LI_IMPORT_CONFIG list-first + delayed background enrich defaults", () => {
  const g = loadConfigSandbox();
  const cfg = g.LI_IMPORT_CONFIG;
  assert.ok(cfg.brandName);
  assert.ok(cfg.tokenPrefix);
  assert.equal(cfg.inlineEnrichDuringScan, false);
  assert.equal(cfg.backgroundEnrichListed, true);
  assert.ok(cfg.backgroundEnrichDelayMinutes >= 2);
  assert.equal(cfg.enrichProfiles, true);
  assert.equal(cfg.skipEnrichWithoutAi, true);
  assert.equal(cfg.aiProvider, "");

  const resolve = g.liImportResolveFeatures;
  const off = resolve(cfg, null);
  assert.equal(off.aiEnabled, false);
  assert.equal(off.enrichEnabled, false, "no inline enrich during scan");
  assert.equal(off.backgroundEnrichEnabled, true, "background enrich queued later");

  const withAi = resolve({ ...cfg, aiProvider: "host", inlineEnrichDuringScan: true }, null);
  assert.equal(withAi.aiEnabled, true);
  assert.equal(withAi.enrichEnabled, true);

  const hostForceInline = resolve(cfg, { enrich: true });
  assert.equal(hostForceInline.enrichEnabled, true);
  assert.equal(hostForceInline.backgroundEnrichEnabled, true);
});
