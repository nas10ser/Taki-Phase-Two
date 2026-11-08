#!/usr/bin/env node
/**
 * v15.78 — لا عنوانَ خادمٍ ميتاً ولا مفتاحاً ميتاً في سطحٍ تشغيليّ.
 *
 * 🔴 تغيّر خادمُ الإنتاج في ١٩ أكتوبر ٢٠٢٦ (نفدت باقةُ أوراكل المجّانية فاشترك
 *    ناصر بمقابل، فأُنشئ جهازٌ جديد). وبقي العنوانُ القديم `141.147.142.147`
 *    والمفتاحُ القديم `taki_oracle` في **تسعة ملفّاتٍ تشغيليّة** تسعةَ عشرَ
 *    يوماً — ومنها `supabase/ops/RECOVERY.md` الذي يُقرأ وقتَ الكارثة
 *    بالضبط، و`scripts/deploy-email-templates.sh` وهو **الطريقُ الوحيد**
 *    لإصلاح بريد الحسابات، و`scripts/rollback-signup-protection.sh` وهو
 *    تراجعُ يوم الإطلاق. كلُّها كانت ستفشل بـ«Connection refused» في أسوأ
 *    لحظةٍ ممكنة، بلا أيّ إنذارٍ قبلها. كشفها تدقيقٌ خصميّ لا قراءةٌ عابرة.
 *
 * 🪤 ولا تُفحص `CLAUDE.md` ولا `.gitignore` ولا `progress/`: الأوّلُ يُحذّر منها
 *    بالاسم (وذاك مقصود)، والثاني نمطُ استثناءٍ يحرس المفاتيح، والثالثُ تاريخٌ
 *    لا يُعاد كتابته. فالمدى هنا **ما يُنفَّذ أو يُتَّبع خطوةً خطوة**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 v15.79 — ثقبان في هذا الحارس نفسه، كشفهما تدقيقُ السطح الثامن
 * ═══════════════════════════════════════════════════════════════════════════
 *  ١) **`Caddyfile` لم يُفحَص ولا مرّةً**: `path.extname('Caddyfile')` سلسلةٌ
 *     فارغة، و`EXT` لا تحمل الفراغَ — فإعدادُ الوسيط الذي يحمل اسمَ الموقع
 *     وشهادتَه كان **خارج المدى كلّه** وهو من أخطر ملفّاته. صار يُفحَص بالاسم.
 *  ٢) **وعنوانُ الموقع كان يُقرأ من متغيّرِ بيئةٍ لا يراه أحد**: السطرُ
 *     `{$PROXY_DOMAIN}, api.takisa.net {`، والمتغيّرُ ما زال يحمل
 *     `141-147-142-147.sslip.io` (خادمُنا السابق، تركناه ١٩ أكتوبر). ولم
 *     يُمسكه أيُّ نمطٍ هنا لسببَين: الملفُّ غيرُ مفحوص، **ونمطُ العنوان مكتوبٌ
 *     بالنقاط** (`141\.147\.142\.147`) والاسمُ الميتُ مكتوبٌ **بالشرطات**.
 *     فالحارسُ الصحيح بنيويّ لا نصّيّ: عنوانُ موقعٍ يُقرأ من متغيّرٍ ليس
 *     عنواناً مراجَعاً — ونمطٌ نصّيٌّ ثالثٌ كان سيُمسك تحذيراتِ
 *     `supabase/ops/RECOVERY.md` نفسَها (ثامنُ وقوعٍ لفخّ «الحارسُ يقرأ تعليقَه»).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/** أسطحٌ تشغيليّة: سكربتات · أدلّةُ عمليّات · سيرُ عملٍ آليّ. */
const DIRS = ['scripts', 'supabase/ops', '.github/workflows'];
const EXT = new Set(['.sh', '.js', '.md', '.yml', '.yaml', '.sql', '.mjs', '.cjs']);
/** ملفّاتٌ تشغيليّةٌ **بلا امتداد** — فلا يراها مرشّحُ الامتداد إطلاقاً. */
const NAMES = new Set(['Caddyfile', 'Dockerfile']);

const DEAD = [
  { re: /141\.147\.142\.147/, what: 'عنوانُ خادمٍ ميت (الحيُّ 207.127.99.122)' },
  { re: /taki_oracle/, what: 'مفتاحُ SSH ميت (الحيُّ ~/.ssh/taki_jeddah2)' },
  { re: /Desktop\/TAKI-مفاتيح-الخدمات/, what: 'مسارُ ملفّ مفاتيحَ قديم (الحيُّ Desktop/TAKI/محلّي/مفاتيح/)' },
  { re: /Desktop\/TAKI-مفتاح-النسخ/, what: 'مسارُ مفتاح النسخ القديم (الحيُّ Desktop/TAKI/محلّي/مفاتيح/)' },
];

/** 🪤 الحارسُ لا يكون موضوعَ نفسه: تعليقُه أعلاه يسمّي الميتَ بالاسم ليشرحه،
 *     فلو فحص نفسَه لسقط دائماً — وهو سابعُ وقوعٍ لفخّ «الحارسُ يقرأ تعليقَه». */
const SELF = path.relative(ROOT, __filename);

const walk = (dir, out = []) => {
  let entries;
  try { entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); }
  catch { return out; }                        // دليلٌ غائبٌ ليس فشلاً
  for (const e of entries) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, out); }
    else if ((EXT.has(path.extname(e.name)) || NAMES.has(e.name)) && rel !== SELF) out.push(rel);
  }
  return out;
};

const hits = [];
for (const d of DIRS) {
  for (const rel of walk(d)) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((ln, i) => {
      for (const d2 of DEAD) if (d2.re.test(ln)) hits.push({ rel, line: i + 1, what: d2.what });
    });
  }
}

// ── عنوانُ موقع Caddy يكون اسماً حرفياً نملكه، لا متغيّرَ بيئة ──────────────
// 🪤 والفحصُ **بنيويّ لا نصّيّ**: سطرُ عنوانِ الموقع هو ما بلا إزاحةٍ وينتهي
//    بـ`{`. فـ`{$PROXY_AUTH_USERNAME}` داخل `basic_auth` (وهو الموضعُ الصحيح
//    لمتغيّرِ بيئة: سرٌّ لا يُكتب في مستودعٍ عام) مُزاحٌ فلا يُمَسّ.
const CADDYFILE = 'supabase/ops/caddy/Caddyfile';
try {
  fs.readFileSync(path.join(ROOT, CADDYFILE), 'utf8').split('\n').forEach((ln, i) => {
    if (/^\S/.test(ln) && !ln.trimStart().startsWith('#') && /\{\s*$/.test(ln) && /\{\$/.test(ln)) {
      hits.push({
        rel: CADDYFILE, line: i + 1,
        what: 'عنوانُ موقعٍ من متغيّرِ بيئة — قيمتُه لا تُراجَع، وكانت خادماً ميتاً ١٩ يوماً',
      });
    }
  });
} catch { /* ملفٌّ غائبٌ ليس فشلاً — نفسُ قاعدة walk */ }

if (hits.length) {
  console.error('❌ مرجعٌ ميتٌ في سطحٍ تشغيليّ — سيفشل في أسوأ لحظة:');
  for (const h of hits) console.error(`   • ${h.rel}:${h.line} — ${h.what}`);
  console.error('   الإصلاحُ تحديثُ الموضع، لا استثناؤه من الفحص.');
  process.exit(1);
}
console.log('✅ لا عنوانَ ولا مفتاحَ ميتاً في السكربتات وأدلّة العمليّات وسير العمل');
