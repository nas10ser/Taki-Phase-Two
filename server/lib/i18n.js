// ── Bot i18n engine ───────────────────────────────────────────────────────────
// Minimal, dependency-free. The dictionary lives in i18n-data.json as
//   { "<key>": { "ar": "…{0}…", "en": "…{0}…" }, … }
// Arabic is the source of truth; English is additive. Any missing key OR missing
// language falls back to Arabic, so the bot can NEVER show a blank/broken string —
// honouring «بدون تغيير أي شي»: the Arabic experience is byte-for-byte unchanged.
//
// t(lang, key, ...args)  → low-level lookup (lang = 'ar' | 'en')
// fill replaces {0},{1}… with args in order (same placeholders in ar & en).
// v11.83
const DATA = require('./i18n-data.json');
const LANGS = ['ar', 'en'];

const normLang = l => (LANGS.includes(l) ? l : 'ar');

function fill(tpl, args) {
  if (!args || !args.length) return tpl;
  return String(tpl).replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[+i];
    return v == null ? '' : String(v);
  });
}

function t(lang, key, ...args) {
  const e = DATA[key];
  if (!e) return key;                       // unknown key → show the key (loud in dev, never crashes)
  const l = normLang(lang);
  const tpl = e[l] != null ? e[l] : (e.ar != null ? e.ar : key);
  return fill(tpl, args);
}

// Does an English translation actually exist for this key? (used to decide whether
// a screen is fully covered before exposing it in English.)
const hasEn = key => !!(DATA[key] && DATA[key].en != null);

module.exports = { t, hasEn, LANGS, DATA };
