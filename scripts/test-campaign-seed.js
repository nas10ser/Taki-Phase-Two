#!/usr/bin/env node
/**
 * بذرُ الحملة الترويجية — اختبارٌ **تنفيذيّ** على الدالّة نفسِها.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي يحرسه (بلاغُ ناصر بلقطة، ١٧ نوفمبر ٢٠٢٦): «تعديل الحملة» ثمّ
 *    «حفظ التعديلات» كان يرمي
 *        null is not an object (evaluating 'b.image_url.trim')
 *    فلا تُحفظ الحملةُ أبداً. والسببُ بذرٌ بنشرٍ أعمى لصفّ القاعدة، فعمودٌ
 *    `null` يدهس الافتراضَ النصّيّ ثمّ تنفجر `.trim()` عليه.
 *
 * 🪤 ولا يكفي أن يُفحص `image_url` وحده: أربعةُ أعمدةٍ نصّيّةٍ كانت مكشوفة،
 *    و`image_url` أوّلُها ترتيباً فهو وحده الذي ظهر في الرسالة. فالاختبارُ
 *    يمرّ على **كلّ** حقلٍ نصّيٍّ في المسودّة، واحداً واحداً.
 *
 * 🪤 والمقياسُ تنفيذٌ لا نصّ: تُترجَم الوحدةُ الخالصة وتُشغَّل، ثمّ يُعاد
 *    بناءُ صفّ الحفظ عليها بنفس استدعاءات `.trim()` التي انفجرت فعلاً.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 🪤 داخل المشروع لا في /tmp (درس v16.28): حلُّ الوحدات يصعد من موضع الملفّ.
const out = path.join(root, 'node_modules', '.cache-campaign-seed');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nبذرُ الحملة الترويجية — صفٌّ فيه `null`');

fs.rmSync(out, { recursive: true, force: true });
let mod;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/components/admin/campaignSeed.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' });
    mod = require(path.join(out, 'campaignSeed.js'));
} catch (e) {
    check('ترجمةُ `campaignSeed.ts`', false, String(e.stdout || e.message).slice(0, 400));
    console.log(`\n❌ بذرُ الحملة: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

const { seedCampaign, emptyCampaign } = mod;

// ── الصفُّ كما يعود من القاعدة فعلاً: أعمدةٌ اختياريّةٌ `null` وأعمدةٌ زائدة ──
const ROW_FROM_DB = {
    id: 'e7b1c2d3-0000-4a5b-8c9d-000000000001',
    created_at: '2026-11-17T09:12:00.000Z',
    last_broadcast_at: null,
    title_ar: 'حملة تجريبية', title_en: null,
    body_ar: 'نصّ الحملة', body_en: null,
    target_audience: 'seller',
    target_city: null, target_region: null,
    image_url: null,                 // ← العمودُ الذي انفجر عند ناصر
    action_url: '/seller-dashboard?tab=form',
    action_label_ar: 'أضف عرضاً جديداً', action_label_en: 'Add a New Deal',
    starts_at: '2026-11-17T11:00:00.000Z', ends_at: null,
    priority: 1000000000, is_active: true,
    recurrence: 'none', recurrence_hour: 14,
};

const draft = seedCampaign(ROW_FROM_DB);

// ① كلُّ حقلٍ نصّيٍّ في المسودّة نصٌّ فعلاً — لا `null` ولا `undefined`
const textKeys = Object.keys(emptyCampaign).filter((k) => typeof emptyCampaign[k] === 'string');
const notText = textKeys.filter((k) => typeof draft[k] !== 'string');
check(`كلُّ الحقول النصّية نصّ (${textKeys.length} حقلاً)`, notText.length === 0,
    notText.length ? `ليست نصّاً: ${notText.join(' · ')}` : '');

// ② المحاكاةُ الحرفيّة لبناء صفّ الحفظ — نفسُ `.trim()` التي انفجرت
let buildErr = null;
try {
    void {
        title_ar: draft.title_ar.trim(),
        title_en: (draft.title_en.trim() || draft.title_ar.trim()),
        body_ar: draft.body_ar.trim(),
        body_en: (draft.body_en.trim() || draft.body_ar.trim()),
        target_city: draft.target_city.trim() || null,
        target_region: draft.target_region.trim() || null,
        image_url: draft.image_url.trim() || null,
        action_url: draft.action_url.trim() || null,
        action_label_ar: draft.action_label_ar.trim() || null,
        action_label_en: draft.action_label_en.trim() || null,
    };
} catch (e) { buildErr = e; }
check('بناءُ صفّ الحفظ لا يرمي على صفٍّ فيه `null`', buildErr === null,
    buildErr && String(buildErr.message));

// ③ كلُّ حقلٍ نصّيٍّ على حدة — فلا يُحمى الظاهرُ في الرسالة وحده
for (const k of textKeys) {
    const d = seedCampaign({ ...ROW_FROM_DB, [k]: null });
    let err = null;
    try { void d[k].trim(); } catch (e) { err = e; }
    check(`«${k}» = null ⇒ لا ينفجر`, err === null, err && String(err.message));
}

// ④ القيمُ الحقيقيّة تُحفظ ولا تُدهَس بالافتراض
check('القيمةُ الحقيقيّة تبقى كما هي', draft.action_url === '/seller-dashboard?tab=form', draft.action_url);
check('الرقمُ يبقى رقماً', draft.priority === 1000000000, String(draft.priority));
check('المنطقي يبقى كما هو', draft.is_active === true, String(draft.is_active));
check('الجمهورُ المختار يبقى', draft.target_audience === 'seller', String(draft.target_audience));

// ⑤ أعمدةُ القاعدة الزائدة لا تتسرّب إلى المسودّة (وإلّا كُتبت في `update`)
const leaked = ['id', 'created_at', 'last_broadcast_at'].filter((k) => k in draft);
check('أعمدةُ القاعدة الزائدة لا تدخل المسودّة', leaked.length === 0,
    leaked.length ? `تسرّبت: ${leaked.join(' · ')}` : '');

// ⑥ لا مصدرَ إطلاقاً (إنشاءُ حملةٍ جديدة) ⇒ مسودّةٌ فارغةٌ صالحة
for (const empty of [null, undefined, {}]) {
    const d = seedCampaign(empty);
    let err = null;
    try { void d.image_url.trim(); } catch (e) { err = e; }
    check(`مصدرٌ ${JSON.stringify(empty) ?? 'undefined'} ⇒ مسودّةٌ صالحة`, err === null && d.recurrence === 'none',
        err && String(err.message));
}

console.log(`\n${fail ? '❌' : '✅'} بذرُ الحملة الترويجية: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
