/**
 * Parse LinkedIn Data Export Connections.csv (browser + Node).
 */
(function registerCustfindLinkedInCSV(root) {
  function parseCSVLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    values.push(current.trim());
    return values;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/^\ufeff/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function indexOfHeader(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
      const idx = normalized.indexOf(candidate);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function isLinkedInConnectionsHeader(headers) {
    const normalized = headers.map(normalizeHeader);
    const hasFirst = normalized.some((h) => h === "first name" || h === "firstname");
    const hasLast = normalized.some((h) => h === "last name" || h === "lastname");
    const hasURL = normalized.some((h) => h === "url" || h === "profile url" || h === "linkedin url");
    return hasFirst && hasLast && hasURL;
  }

  function parseLinkedInConnectionsCSV(text, maxRows = 2500) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return { leads: [], error: "csv_empty" };

    const matrix = lines.map(parseCSVLine);
    const headers = matrix[0];
    if (!isLinkedInConnectionsHeader(headers)) {
      return { leads: [], error: "csv_not_linkedin_connections" };
    }

    const firstIdx = indexOfHeader(headers, ["first name", "firstname"]);
    const lastIdx = indexOfHeader(headers, ["last name", "lastname"]);
    const urlIdx = indexOfHeader(headers, ["url", "profile url", "linkedin url"]);
    const emailIdx = indexOfHeader(headers, ["email address", "email", "e mail"]);
    const companyIdx = indexOfHeader(headers, ["company"]);
    const positionIdx = indexOfHeader(headers, ["position", "title"]);

    const leads = [];
    for (const values of matrix.slice(1)) {
      const first = firstIdx >= 0 ? values[firstIdx] || "" : "";
      const last = lastIdx >= 0 ? values[lastIdx] || "" : "";
      const name = `${first} ${last}`.trim();
      let linkedin = urlIdx >= 0 ? (values[urlIdx] || "").trim() : "";
      if (!name || !linkedin || !/linkedin\.com\/in\//i.test(linkedin)) continue;
      linkedin = linkedin.replace(/\/$/, "");
      leads.push({
        name,
        linkedin_url: linkedin,
        profile_url: linkedin,
        email: emailIdx >= 0 ? (values[emailIdx] || "").trim() : "",
        company: companyIdx >= 0 ? (values[companyIdx] || "").trim() : "",
        title: positionIdx >= 0 ? (values[positionIdx] || "").trim() : ""
      });
      if (leads.length >= maxRows) break;
    }

    if (leads.length === 0) return { leads: [], error: "csv_no_rows" };
    return { leads, error: "" };
  }

  const api = {
    isLinkedInConnectionsHeader,
    parseLinkedInConnectionsCSV
  };
  root.CustfindLinkedInCSV = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
