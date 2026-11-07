#!/usr/bin/env node
/**
 * Reads extension/config.js LI_IMPORT_CONFIG and updates manifest.json:
 * - extension name / description (per language, in extension/_locales) from brand
 * - host_permissions for prodApiBase (+ defaultApiBase localhost variants)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "extension", "config.js");
const manifestPath = path.join(root, "extension", "manifest.json");
const localesDir = path.join(root, "extension", "_locales");

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

  const brand = cfg.brandName || "Dgmos";
  const tag = cfg.brandTag || "Lead Capture";
  const name = `${brand} ${tag}`.replace(/\s+/g, " ").trim();
  const descriptions = {
    en: `Capture profiles and save them to ${brand}.`,
    tr: `Profilleri yakalayın ve ${brand}'a kaydedin.`
  };
  for (const [lang, description] of Object.entries(descriptions)) {
    const file = path.join(localesDir, lang, "messages.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const messages = { extName: { message: name }, extDescription: { message: description } };
    fs.writeFileSync(file, `${JSON.stringify(messages, null, 2)}\n`);
  }
  manifest.default_locale = "en";
  manifest.name = "__MSG_extName__";
  manifest.description = "__MSG_extDescription__";
  if (manifest.action) {
    manifest.action.default_title = "__MSG_extName__";
  }

  const linkedIn = ["https://www.linkedin.com/*", "https://linkedin.com/*"];
  const apiHosts = new Set();
  for (const base of [cfg.prodApiBase, cfg.defaultApiBase]) {
    const perm = originPermission(base);
    if (perm) apiHosts.add(perm);
  }
  // Local Dgmos backend (any port) for development.
  apiHosts.add("http://localhost/*");
  apiHosts.add("http://127.0.0.1/*");

  manifest.host_permissions = [...linkedIn, ...apiHosts];

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`apply-config: updated ${path.relative(root, manifestPath)}`);
  console.log(`  name=${name}`);
  console.log(`  host_permissions=${manifest.host_permissions.join(", ")}`);
}

apply();
