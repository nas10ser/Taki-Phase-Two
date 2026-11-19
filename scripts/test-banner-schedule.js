#!/usr/bin/env node
/**
 * جدولةُ البانر — اختبارٌ **تنفيذيّ** على دالّة القرار نفسِها.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «تاريخٌ محدَّد من وإلى **والساعة**، أو أيامٌ
 *    **تُحسب بالدقيقة** — أسبوع أو أسبوعان أو شهر أو أيّ عدد — أو **مفتوحة**».
 *
 * 🔴 والخطرُ الصامت الذي يحرسه: تواريخُ متناقضة تُحفظ بلا شكوى، ثمّ تُسقط
 *    السياسةُ البانرَ بصمت — فيظنّ الأدمنُ أن النشر فشل ويُعيد المحاولة.
 *    فكلُّ حالةٍ تُنتج بانراً لا يظهر أبداً **تُرفض قبل الحفظ** برسالةٍ تقول السبب.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-banner-schedule');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nجدولةُ البانر — مفتوحة · عدد أيام · من/إلى بالساعة');

fs.rmSync(out, { recursive: true, force: true });
let computeBannerSchedule, scheduleModeOf, MAX_SCHEDULE_DAYS;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/components/admin/bannerScheduleRule.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'],
    { cwd: root, stdio: 'pipe' });
    ({ computeBannerSchedule, scheduleModeOf, MAX_SCHEDULE_DAYS } =
        require(path.join(out, 'src/components/admin/bannerScheduleRule.js')));
} catch (e) {
    check('ترجمةُ `bannerScheduleRule.ts`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ جدولةُ البانر: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

const NOW = Date.UTC(2026, 10, 20, 9, 0, 0);     // ٢٠ نوفمبر ٢٠٢٦، ٩ صباحاً
const MIN = 60_000, DAY = 86_400_000;

// ── ① مفتوحة ────────────────────────────────────────────────────────────
{
    const r = computeBannerSchedule({ mode: 'open' }, NOW);
    check('«مفتوحة» ⇒ بلا بدايةٍ ولا نهاية',
        r.startsAt === null && r.expiresAt === null && r.error === null, JSON.stringify(r));
}

// ── ② عدد أيام — **بالدقيقة** لا باليوم ─────────────────────────────────
for (const [label, days] of [['أسبوع', 7], ['أسبوعان', 14], ['شهر', 30], ['يوم', 1]]) {
    const r = computeBannerSchedule({ mode: 'days', days }, NOW);
    const span = new Date(r.expiresAt).getTime() - new Date(r.startsAt).getTime();
    check(`«${label}» (${days}) ⇒ المدّةُ بالضبط`, r.error === null && span === days * DAY,
        `الفارق ${span} والمتوقَّع ${days * DAY}`);
}
{
    // 🔴 جوهرُ «يُحسب بالدقيقة»: البدايةُ لحظةُ الحفظ لا منتصفُ الليل.
    const r = computeBannerSchedule({ mode: 'days', days: 7 }, NOW);
    check('البدايةُ لحظةُ الحفظ نفسُها (لا منتصف الليل)',
        new Date(r.startsAt).getTime() === NOW, r.startsAt);
    const r2 = computeBannerSchedule({ mode: 'days', days: 7 }, NOW + 37 * MIN);
    check('وتحريكُ الساعة ٣٧ دقيقة يُحرّك النهايةَ ٣٧ دقيقة',
        new Date(r2.expiresAt).getTime() - new Date(r.expiresAt).getTime() === 37 * MIN);
    const half = computeBannerSchedule({ mode: 'days', days: 0.5 }, NOW);
    check('ونصفُ يومٍ = ١٢ ساعة',
        new Date(half.expiresAt).getTime() - NOW === DAY / 2, half.expiresAt);
}
// والمرفوض
for (const [label, days] of [['صفر', 0], ['سالب', -3], ['فارغ', ''], ['نصّ', 'كثير']]) {
    const r = computeBannerSchedule({ mode: 'days', days }, NOW);
    check(`«${label}» يُرفض برسالة`, r.error !== null && r.expiresAt === null, JSON.stringify(r));
}
{
    const r = computeBannerSchedule({ mode: 'days', days: MAX_SCHEDULE_DAYS + 1 }, NOW);
    check(`وما فوق ${MAX_SCHEDULE_DAYS} يوماً يُرفض ويُحال إلى «من/إلى»`,
        r.error !== null && /من \/ إلى|من\/إلى/.test(r.error), JSON.stringify(r));
}

// ── ③ من/إلى بالساعة ────────────────────────────────────────────────────
{
    const r = computeBannerSchedule(
        { mode: 'range', from: '2026-11-25T17:30', to: '2026-12-01T23:00' }, NOW);
    check('«من/إلى» تُنتج تاريخين', r.error === null && !!r.startsAt && !!r.expiresAt, JSON.stringify(r));
    // 🪤 الساعةُ تُقرأ بتوقيت الجهاز (كما كتبها ناصر) — تُفحص بإعادة التحويل.
    const back = new Date(r.startsAt);
    check('والساعةُ تُحفظ كما كُتبت بتوقيت الجهاز',
        back.getHours() === 17 && back.getMinutes() === 30,
        `${back.getHours()}:${back.getMinutes()}`);
}
{
    const only = computeBannerSchedule({ mode: 'range', from: '2026-11-25T08:00' }, NOW);
    check('«من» وحدها ⇒ يبدأ حينها ولا ينتهي',
        only.error === null && !!only.startsAt && only.expiresAt === null, JSON.stringify(only));
    const until = computeBannerSchedule({ mode: 'range', to: '2026-12-25T08:00' }, NOW);
    check('«إلى» وحدها ⇒ يبدأ فوراً وينتهي حينها',
        until.error === null && until.startsAt === null && !!until.expiresAt, JSON.stringify(until));
}

// ── ④ ما يُنتج بانراً لا يظهر أبداً — يُرفض قبل الحفظ ───────────────────
{
    const back = computeBannerSchedule(
        { mode: 'range', from: '2026-12-10T10:00', to: '2026-12-01T10:00' }, NOW);
    check('نهايةٌ قبل البداية تُرفض (وإلّا بانرٌ لا يظهر بلا رسالة)',
        back.error !== null, JSON.stringify(back));
    const past = computeBannerSchedule({ mode: 'range', to: '2026-11-01T10:00' }, NOW);
    check('ونهايةٌ في الماضي تُرفض', past.error !== null, JSON.stringify(past));
    const same = computeBannerSchedule(
        { mode: 'range', from: '2026-12-01T10:00', to: '2026-12-01T10:00' }, NOW);
    check('ونهايةٌ تساوي البداية تُرفض', same.error !== null, JSON.stringify(same));
    const empty = computeBannerSchedule({ mode: 'range' }, NOW);
    check('و«من/إلى» بلا أيّ تاريخٍ تُرفض', empty.error !== null, JSON.stringify(empty));
    const bad = computeBannerSchedule({ mode: 'range', from: 'ليس تاريخاً' }, NOW);
    check('وتاريخٌ فاسد يُرفض', bad.error !== null, JSON.stringify(bad));
}

// ── ⑤ فتحُ المحرّر على صفٍّ قائم ────────────────────────────────────────
check('صفٌّ بلا تواريخ ⇒ يُفتح على «مفتوحة»', scheduleModeOf({}) === 'open');
check('وصفٌّ له نهاية ⇒ يُفتح على «من/إلى»',
    scheduleModeOf({ expires_at: '2026-12-01T00:00:00Z' }) === 'range');
check('ولا يُخمَّن «أيام» من الفرق (بانرٌ عُدّلت نهايتُه يدوياً يُقرأ كذباً)',
    scheduleModeOf({ starts_at: '2026-11-20T00:00:00Z', expires_at: '2026-11-27T00:00:00Z' }) === 'range');
check('و`null` ⇒ «مفتوحة»', scheduleModeOf(null) === 'open');

console.log(`\n${fail ? '❌' : '✅'} جدولةُ البانر: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
