const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");

test("normalizeLinkedInURL strips query and trailing slash", () => {
  assert.equal(
    core.normalizeLinkedInURL("https://www.linkedin.com/in/jane-doe/?trk=foo"),
    "https://www.linkedin.com/in/jane-doe"
  );
  assert.equal(
    core.normalizeLinkedInURL("https://www.linkedin.com/company/tmgdk/"),
    "https://www.linkedin.com/company/tmgdk"
  );
  assert.equal(core.normalizeLinkedInURL("https://example.com/in/x"), "");
});

test("detectImportModeFromPath covers connections search and company people", () => {
  assert.equal(
    core.detectImportModeFromPath("/mynetwork/invite-connect/connections/"),
    "connections"
  );
  assert.equal(core.detectImportModeFromPath("/search/results/people/"), "search");
  assert.equal(core.detectImportModeFromPath("/search/results/companies/"), "search");
  assert.equal(core.detectImportModeFromPath("/company/tmgdk/people/"), "search");
  assert.equal(core.detectImportModeFromPath("/sales/search/people"), "search");
  assert.equal(core.detectImportModeFromPath("/talent/search"), "search");
  assert.equal(core.detectImportModeFromPath("/in/jane-doe/"), "quick");
});

test("isProfilePath rejects reserved slugs", () => {
  assert.equal(core.isProfilePath("/in/jane-doe"), true);
  assert.equal(core.isProfilePath("/in/search"), false);
  assert.equal(core.isProfilePath("/in/company"), false);
});

test("isCompanyPath accepts overview and about", () => {
  assert.equal(core.isCompanyPath("/company/tmgdk"), true);
  assert.equal(core.isCompanyPath("/company/tmgdk/"), true);
  assert.equal(core.isCompanyPath("/company/tmgdk/about"), true);
  assert.equal(core.isCompanyPath("/company/tmgdk/about/"), true);
  assert.equal(core.isCompanyPath("/company/tmgdk/people/"), false);
});

test("detectPageGate flags login and challenge", () => {
  const loginDoc = {
    querySelector: () => null,
    body: { innerText: "Sign in to view more profiles on LinkedIn" }
  };
  assert.equal(core.detectPageGate(loginDoc, "https://www.linkedin.com/search/results/all/").error, "login_required");

  const challengeDoc = {
    querySelector: (sel) => (sel.includes("challenge-dialog") ? {} : null),
    body: { innerText: "Welcome" }
  };
  assert.equal(
    core.detectPageGate(challengeDoc, "https://www.linkedin.com/feed/").error,
    "challenge_required"
  );

  const okDoc = {
    querySelector: (sel) => (sel.includes("/in/") ? {} : null),
    body: { innerText: "Results" }
  };
  assert.equal(core.detectPageGate(okDoc, "https://www.linkedin.com/search/results/people/").ok, true);
});

test("normalizeLeadsForApi prefers profile_url and maps headline to title", () => {
  const [lead] = core.normalizeLeadsForApi([
    {
      name: "Ada",
      linkedin_url: "https://www.linkedin.com/in/ada",
      headline: "Engineer at Analytical Engines",
      location: "London"
    }
  ]);
  assert.equal(lead.profile_url, "https://www.linkedin.com/in/ada");
  assert.equal(lead.title, "Engineer at Analytical Engines");
  assert.equal(lead.location, "London");
});

test("isSearchEmpty detects empty-state markers", () => {
  const emptyDoc = {
    querySelector: (sel) => (sel === ".search-reusable-empty-state" ? {} : null)
  };
  assert.equal(core.isSearchEmpty(emptyDoc), true);
  assert.equal(core.isSearchEmpty({ querySelector: () => null }), false);
});
