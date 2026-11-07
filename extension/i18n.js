// UI language follows the browser: Turkish when the browser UI language is Turkish, English otherwise.
// English text is the key; TR maps it to Turkish. Missing entries fall back to English.
(function registerDgmosI18n() {
  const TR = globalThis.DGMOS_I18N_TR || {};

  function detectLang() {
    let ui = "";
    try {
      ui = globalThis.chrome?.i18n?.getUILanguage?.() || "";
    } catch {
      ui = "";
    }
    if (!ui) ui = globalThis.navigator?.language || "en";
    return /^tr\b/i.test(ui) ? "tr" : "en";
  }

  const lang = detectLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";

  function format(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }

  function t(text, vars) {
    const translated = lang === "tr" ? TR[text] : undefined;
    return format(translated ?? text, vars);
  }

  // Static HTML: elements marked data-i18n use their own English text as the key,
  // data-i18n-html their inner HTML, and data-i18n-attr="placeholder,aria-label" those attributes.
  function apply(root) {
    const doc = root || globalThis.document;
    if (!doc) return;
    if (doc.documentElement) doc.documentElement.lang = lang;
    if (lang === "en") return;
    doc.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.textContent.replace(/\s+/g, " ").trim();
      if (TR[key]) el.textContent = TR[key];
    });
    doc.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.innerHTML.replace(/\s+/g, " ").trim();
      if (TR[key]) el.innerHTML = TR[key];
    });
    doc.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      for (const attr of el.getAttribute("data-i18n-attr").split(",")) {
        const name = attr.trim();
        const key = el.getAttribute(name);
        if (key && TR[key]) el.setAttribute(name, TR[key]);
      }
    });
  }

  globalThis.DgmosI18n = { lang, locale, t, format, apply };
})();
