const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRegistry() {
  const sandbox = {
    URL,
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.LI_IMPORT_CONFIG = {
    brandName: "Acme",
    enrichProfiles: true,
    inlineEnrichDuringScan: true,
    backgroundEnrichListed: true,
    skipEnrichWithoutAi: false,
    aiProvider: "",
    enrichBatchSize: 8,
    enrichSessionMax: 80,
    enrichPauseMs: 5500,
    enrichBatchPauseMs: 45000,
    limits: { connections: 10, search: 5, batch: 100, enrichMax: 10 }
  };
  vm.createContext(sandbox);
  const coreSrc = fs.readFileSync(path.join(__dirname, "linkedin/core.js"), "utf8");
  const registrySrc = fs.readFileSync(path.join(__dirname, "registry.js"), "utf8");
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(registrySrc, sandbox);
  return sandbox.liImportProviderRegistry;
}

test("registry resolves linkedin provider with config brand and limits", () => {
  const registry = loadRegistry();
  const provider = registry.getProvider("linkedin");
  assert.ok(provider);
  assert.equal(provider.enabled, true);
  assert.equal(provider.scrape.enrichProfiles, true);
  assert.equal(provider.scrape.enrichBatchSize, 8);
  assert.equal(provider.scrape.enrichSessionMax, 80);
  assert.equal(provider.scrape.maxLeads, 10);
  assert.equal(provider.scrapeSearch.maxLeads, 5);
  assert.equal(provider.api.parseProfile, "liImportLinkedInParseProfile");
  assert.match(provider.ui.importTitle, /Acme/);
  assert.ok(provider.ui.stepsConnections.some((s) => s.key === "enrich"));
  assert.equal(registry.detectProvider("https://www.linkedin.com/in/x"), provider);
  assert.equal(registry.detectProvider("https://example.com"), null);
});

test("detectImportMode connections and search", () => {
  const registry = loadRegistry();
  const provider = registry.getProvider("linkedin");
  assert.equal(
    provider.detectImportMode("https://www.linkedin.com/mynetwork/invite-connect/connections/"),
    "connections"
  );
  assert.equal(
    provider.detectImportMode("https://www.linkedin.com/search/results/people/?keywords=x"),
    "search"
  );
});
