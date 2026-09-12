const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const FIXTURES = path.join(__dirname, "fixtures");

function loadCollector(pageUrl, html) {
  const dom = new JSDOM(html, { url: pageUrl, pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(__dirname, "core.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(__dirname, "collector.js"), "utf8"));
  return window;
}

test("search results parse people cards into listed leads", () => {
  const html = fs.readFileSync(path.join(FIXTURES, "search.html"), "utf8");
  const win = loadCollector("https://www.linkedin.com/search/results/people/?keywords=engineer", html);
  const snap = win.liImportLinkedInCollect();
  assert.equal(snap.error, undefined);
  assert.equal(snap.page_type, "search");
  assert.equal(snap.leads.length, 2);
  const ada = snap.leads.find((l) => l.linkedin_url.includes("/in/ada-lovelace"));
  assert.ok(ada);
  assert.equal(ada.name, "Ada Lovelace");
  assert.equal(ada.title, "Engineer");
  assert.equal(ada.company, "Analytical Engines");
  assert.equal(ada.location, "London, United Kingdom");
  assert.equal(ada.email, "");
});

test("connections page parses mn-connection-card", () => {
  const html = fs.readFileSync(path.join(FIXTURES, "connections.html"), "utf8");
  const win = loadCollector("https://www.linkedin.com/mynetwork/invite-connect/connections/", html);
  const leads = win.liImportLinkedInParseConnections();
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, "Jane Doe");
  assert.equal(leads[0].linkedin_url, "https://www.linkedin.com/in/jane-doe");
  assert.equal(leads[0].company, "Acme");
  assert.equal(leads[0].title, "CTO");
});

test("profile page extracts about and identity", () => {
  const html = fs.readFileSync(path.join(FIXTURES, "profile.html"), "utf8");
  const win = loadCollector("https://www.linkedin.com/in/ada-lovelace/", html);
  const snap = win.liImportLinkedInCollect();
  assert.equal(snap.page_type, "profile");
  assert.equal(snap.leads.length, 1);
  const ada = snap.leads[0];
  assert.equal(ada.name, "Ada Lovelace");
  assert.equal(ada.linkedin_url, "https://www.linkedin.com/in/ada-lovelace");
  assert.match(ada.about, /Analytical Engine/);
  assert.equal(ada.company, "Analytical Engines");
});

test("company page maps name website and about", () => {
  const html = fs.readFileSync(path.join(FIXTURES, "company.html"), "utf8");
  const win = loadCollector("https://www.linkedin.com/company/acme/", html);
  const snap = win.liImportLinkedInCollect();
  assert.equal(snap.page_type, "company");
  assert.equal(snap.leads.length, 1);
  assert.equal(snap.leads[0].name, "Acme Ltd");
  assert.equal(snap.leads[0].company, "Acme Ltd");
  assert.equal(snap.leads[0].linkedin_url, "https://www.linkedin.com/company/acme");
  assert.equal(snap.leads[0].website, "https://acme.example");
  assert.match(snap.leads[0].about, /widgets/i);
});
