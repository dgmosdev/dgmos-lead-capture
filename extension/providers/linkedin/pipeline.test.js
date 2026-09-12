const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const csv = require("./csv.js");
const core = require("./core.js");

function collect(pageUrl, fixtureName) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", fixtureName), "utf8");
  const dom = new JSDOM(html, { url: pageUrl, pretendToBeVisual: true, runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(path.join(__dirname, "core.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(__dirname, "collector.js"), "utf8"));
  return dom.window.liImportLinkedInCollect();
}

test("search snapshot maps to API payload the sidecar accepts", () => {
  const snap = collect("https://www.linkedin.com/search/results/people/?keywords=x", "search.html");
  const payload = core.normalizeLeadsForApi(snap.leads);
  assert.equal(payload.length, 2);
  for (const lead of payload) {
    assert.ok(lead.profile_url.startsWith("https://www.linkedin.com/in/"));
    assert.ok(lead.name);
    assert.ok(lead.title);
    assert.ok(lead.company);
    assert.equal(lead.email, undefined);
    assert.equal(lead.about, undefined);
  }
});

test("profile snapshot carries about into API payload", () => {
  const snap = collect("https://www.linkedin.com/in/ada-lovelace/", "profile.html");
  const [lead] = core.normalizeLeadsForApi(snap.leads);
  assert.equal(lead.profile_url, "https://www.linkedin.com/in/ada-lovelace");
  assert.match(lead.about, /Analytical Engine/);
});

test("Connections.csv export maps to API leads", () => {
  const text = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://www.linkedin.com/in/jane-doe/,jane@example.com,Acme,CEO,01 Jan 2024
Skip,Row,https://example.com/not-linkedin,,,Bad,01 Jan 2024
`;
  const parsed = csv.parseLinkedInConnectionsCSV(text);
  assert.equal(parsed.leads.length, 1);
  const [lead] = core.normalizeLeadsForApi(parsed.leads);
  assert.equal(lead.profile_url, "https://www.linkedin.com/in/jane-doe");
  assert.equal(lead.email, "jane@example.com");
  assert.equal(lead.company, "Acme");
  assert.equal(lead.title, "CEO");
});

test("payload without url is still sent; sidecar skips invalid rows", () => {
  const payload = core.normalizeLeadsForApi([{ name: "Ghost" }, { name: "Ada", linkedin_url: "https://www.linkedin.com/in/ada" }]);
  assert.equal(payload[0].profile_url, "");
  assert.equal(payload[1].profile_url, "https://www.linkedin.com/in/ada");
});
