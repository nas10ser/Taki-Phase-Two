#!/usr/bin/env node
/**
 * مدّةُ البانر — اختبارٌ **تنفيذيّ** على الشرط، وتطابقُه مع القاعدة.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «وضعتُ تاريخاً وساعةً… ولم يختفِ إلّا بعد
 *    عشر دقائق… ولا يزال موجوداً رغم أن وقته انتهى». وقِيس على الإنتاج:
 *    بانرٌ انتهى ١٧:١٣ وهو معروضٌ الساعةَ ١٧:٥٨ — لأن سياسةَ RLS تُعفي
 *    الأدمن، وناصر أدمن.
 *
 * 🔴 **والخطرُ هنا تَفارُقُ الشرطين**: إن أخفى المتصفّحُ ما لا يُخفيه الخادم
 *    (أو العكس) ظهر البانرُ ثمّ اختفى ثمّ عاد مع أوّل جلبة. ولذلك يُقاس
 *    التطابقُ نصّاً مع الهجرة، **وعدمُ التماثل مقصود**:
 *    البدايةُ تشمل اللحظة (`<=`) والنهايةُ لا (`>`).
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-banner-window');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nمدّةُ البانر');

fs.rmSync(out, { recursive: true, force: true });
let bannerVisibleAt, nextBannerChangeAt;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/utils/bannerSchedule.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'], { cwd: root, stdio: 'pipe' });
    ({ bannerVisibleAt, nextBannerChangeAt } = require(path.join(out, 'src/utils/bannerSchedule.js')));
} catch (e) {
    check('ترجمةُ `bannerSchedule.ts`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ مدّةُ البانر: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

const NOW = Date.parse('2026-11-19T17:58:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;

// ── ① الحالةُ العامّة ────────────────────────────────────────────────────
check('بلا حدّين ⇒ يُعرض', bannerVisibleAt({}, NOW));
check('و`null` صريحان ⇒ يُعرض', bannerVisibleAt({ starts_at: null, expires_at: null }, NOW));

// ── ② النهاية — وهذا بلاغُ ناصر بعينه ────────────────────────────────────
check('انتهى قبل دقيقة ⇒ يُخفى',
    !bannerVisibleAt({ expires_at: iso(NOW - MIN) }, NOW));
check('وينتهي بعد دقيقة ⇒ يُعرض',
    bannerVisibleAt({ expires_at: iso(NOW + MIN) }, NOW));
// 🪤 القاعدةُ `expires_at > now()` — فاللحظةُ نفسُها **منتهية**
check('واللحظةُ نفسُها ⇒ يُخفى (`>` لا `>=`)',
    !bannerVisibleAt({ expires_at: iso(NOW) }, NOW));
check('وبعدها بمللي ثانية واحدة ⇒ يُعرض',
    bannerVisibleAt({ expires_at: iso(NOW + 1) }, NOW));

// ── ③ البداية ────────────────────────────────────────────────────────────
check('يبدأ غداً ⇒ يُخفى',
    !bannerVisibleAt({ starts_at: iso(NOW + 86_400_000) }, NOW));
// 🪤 القاعدةُ `starts_at <= now()` — فاللحظةُ نفسُها **بدأت**
check('واللحظةُ نفسُها ⇒ يُعرض (`<=` لا `<`)',
    bannerVisibleAt({ starts_at: iso(NOW) }, NOW));
check('وبدأ أمس وينتهي غداً ⇒ يُعرض',
    bannerVisibleAt({ starts_at: iso(NOW - 86_400_000), expires_at: iso(NOW + 86_400_000) }, NOW));
check('وبدأ أمس وانتهى اليوم ⇒ يُخفى',
    !bannerVisibleAt({ starts_at: iso(NOW - 86_400_000), expires_at: iso(NOW - MIN) }, NOW));

// ── ④ قيمٌ فاسدة لا تُخفي بانراً مدفوعاً ─────────────────────────────────
for (const [label, v] of [['نصٌّ غيرُ تاريخ', 'غداً'], ['فارغ', ''], ['NaN', NaN]]) {
    check(`${label} ⇒ يُعرض (لا نُخفي على جهل)`,
        bannerVisibleAt({ expires_at: v, starts_at: v }, NOW), JSON.stringify(v));
}

// ── ⑤ لحظةُ التغيّر القادم — عليها يُضبط المؤقّت ─────────────────────────
check('بلا حدود ⇒ لا تغيّرَ قادم', nextBannerChangeAt([{}, { expires_at: null }], NOW) === null);
check('يتجاهل ما مضى', nextBannerChangeAt([{ expires_at: iso(NOW - MIN) }], NOW) === null);
check('ويختار الأقربَ من بين عدّة بانرات',
    nextBannerChangeAt([
        { expires_at: iso(NOW + 10 * MIN) },
        { starts_at: iso(NOW + 3 * MIN), expires_at: iso(NOW + 99 * MIN) },
        { expires_at: iso(NOW - MIN) },
    ], NOW) === NOW + 3 * MIN);
check('وقائمةٌ فارغة ⇒ null', nextBannerChangeAt([], NOW) === null);
check('و`undefined` لا يرمي', nextBannerChangeAt(undefined, NOW) === null);

// ── ⑥ 🔴 التطابقُ مع شرط القاعدة — نصّاً، لا بالذاكرة ────────────────────
const mig = fs.readFileSync(path.join(root, 'supabase/JEDDAH_v16_49_banner_schedule_feed.sql'), 'utf8');
check('الهجرةُ تشترط `starts_at <= now()`', /starts_at\s*<=\s*now\(\)/.test(mig));
check('والهجرةُ تشترط `expires_at > now()` (لا `>=`)',
    /expires_at\s*>\s*now\(\)/.test(mig) && !/expires_at\s*>=\s*now\(\)/.test(mig));

const ts = fs.readFileSync(path.join(root, 'src/utils/bannerSchedule.ts'), 'utf8');
check('والمتصفّحُ يشترط `s <= now`', /s\s*<=\s*nowMs/.test(ts));
check('والمتصفّحُ يشترط `e > now`', /e\s*>\s*nowMs/.test(ts));

console.log(`\n${fail ? '❌' : '✅'} مدّةُ البانر: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
