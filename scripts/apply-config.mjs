#!/usr/bin/env node
/**
 * Reads extension/config.js LI_IMPORT_CONFIG and updates manifest.json:
 * - name / description / action.default_title from brand
 * - host_permissions for prodApiBase (+ defaultApiBase localhost variants)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "extension", "config.js");
const manifestPath = path.join(root, "extension", "manifest.json");

function loadConfig() {
  const source = fs.readFileSync(configPath, "utf8");
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const cfg = sandbox.globalThis.LI_IMPORT_CONFIG || sandbox.globalThis.DGMOS_EXT_CONFIG;
  if (!cfg) {
    throw new Error("LI_IMPORT_CONFIG not found in extension/config.js");
  }
  return cfg;
}

function originPermission(apiBase) {
  try {
    const u = new URL(apiBase);
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

function apply() {
  const cfg = loadConfig();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const brand = cfg.brandName || "LinkedIn Import";
  const tag = cfg.brandTag || "LinkedIn Import";
  manifest.name = `${brand} ${tag}`.replace(/\s+/g, " ").trim();
  manifest.description = `Import LinkedIn connections, search results, and CSV exports into ${brand}.`;
  if (manifest.action) {
    manifest.action.default_title = manifest.name;
  }

  const linkedIn = ["https://www.linkedin.com/*", "https://linkedin.com/*"];
  const apiHosts = new Set();
  for (const base of [cfg.prodApiBase, cfg.defaultApiBase]) {
    const perm = originPermission(base);
    if (perm) apiHosts.add(perm);
  }
  // Local convenience aliases when using localhost
  if ([...apiHosts].some((h) => h.includes("localhost"))) {
    apiHosts.add("http://127.0.0.1:8088/*");
    apiHosts.add("http://localhost:8088/*");
  }

  manifest.host_permissions = [...linkedIn, ...apiHosts];

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`apply-config: updated ${path.relative(root, manifestPath)}`);
  console.log(`  name=${manifest.name}`);
  console.log(`  host_permissions=${manifest.host_permissions.join(", ")}`);
}

apply();
