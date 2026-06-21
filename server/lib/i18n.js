// ── Bot i18n engine ───────────────────────────────────────────────────────────
// Minimal, dependency-free. The dictionary lives in i18n-data.json as
//   { "<key>": { "ar": "…{0}…", "en": "…{0}…" }, … }
// Arabic is the source of truth; English is additive. Any missing key OR missing
// language falls back to Arabic, so the bot can NEVER show a blank/broken string —
// honouring «بدون تغيير أي شي»: the Arabic experience is byte-for-byte unchanged.
//
// t(lang, key, ...args)  → low-level lookup (lang = 'ar' | 'en')
// tr(key, ...args)        → request-scoped: reads the language from AsyncLocalStorage
//                           (set once per Telegram update), so call sites never have
//                           to thread the language around. Outside any request (cron,
//                           outbox) it falls back to Arabic.
// withLang(l, fn) / setLang(l) → run fn in a language context / change it mid-request.
// fill replaces {0},{1}… with args in order (same placeholders in ar & en).
// v11.85
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
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

// Current request language from ALS (default Arabic when outside a request).
const lang = () => { const s = als.getStore(); return s && s.lang ? s.lang : 'ar'; };
// Request-scoped translate — language resolved from ALS. Use this everywhere.
const tr = (key, ...args) => t(lang(), key, ...args);
// Run `fn` inside a language context (Telegram middleware, outbox per-recipient).
const withLang = (l, fn) => als.run({ lang: normLang(l) }, fn);
// Change the language for the rest of the current request (the 🌐 toggle).
const setLang = l => { const s = als.getStore(); if (s) s.lang = normLang(l); };

// Does an English translation actually exist for this key? (used to decide whether
// a screen is fully covered before exposing it in English.)
const hasEn = key => !!(DATA[key] && DATA[key].en != null);

module.exports = { t, tr, lang, withLang, setLang, als, hasEn, LANGS, DATA };
