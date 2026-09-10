/**
 * Parse LinkedIn Data Export Connections.csv (browser + Node).
 */
(function registerLiImportLinkedInCSV(root) {
  function parseCSVRecords(text) {
    const rows = [];
    let row = [];
    let current = "";
    let inQuotes = false;
    const raw = String(text || "").replace(/^\ufeff/, "");

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '"') {
        if (inQuotes && raw[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(current.trim());
        current = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && raw[i + 1] === "\n") i += 1;
        row.push(current.trim());
        current = "";
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        continue;
      }
      current += ch;
    }
    row.push(current.trim());
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
    return rows;
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
    const matrix = parseCSVRecords(text);
    if (matrix.length < 2) return { leads: [], error: "csv_empty" };

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
        company: companyIdx >= 0 ? (values[companyIdx] || "").trim().replace(/\s+/g, " ") : "",
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
  root.LiImportLinkedInCSV = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
