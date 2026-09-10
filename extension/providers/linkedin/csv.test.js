const test = require("node:test");
const assert = require("node:assert/strict");
const csv = require("./csv.js");

test("parses LinkedIn Connections.csv export", () => {
  const text = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://www.linkedin.com/in/jane-doe/,jane@example.com,Acme,CEO,01 Jan 2024
John,Smith,https://www.linkedin.com/in/john-smith,,Beta,CTO,02 Jan 2024
`;
  const parsed = csv.parseLinkedInConnectionsCSV(text);
  assert.equal(parsed.error, "");
  assert.equal(parsed.leads.length, 2);
  assert.equal(parsed.leads[0].name, "Jane Doe");
  assert.equal(parsed.leads[0].linkedin_url, "https://www.linkedin.com/in/jane-doe");
  assert.equal(parsed.leads[0].email, "jane@example.com");
  assert.equal(parsed.leads[1].company, "Beta");
});

test("parses quoted CSV fields with embedded newlines", () => {
  const text = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
"Jane","Doe","https://www.linkedin.com/in/jane-doe/","jane@example.com","Acme
Labs","CEO","01 Jan 2024"
`;
  const parsed = csv.parseLinkedInConnectionsCSV(text);
  assert.equal(parsed.error, "");
  assert.equal(parsed.leads.length, 1);
  assert.equal(parsed.leads[0].name, "Jane Doe");
  assert.match(parsed.leads[0].company, /Acme/);
});
