#!/usr/bin/env node
/**
 * الشكوى تذهب إلى صندوقها — لا إلى بريد أحد.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (مكرَّرٌ مرّتين، آخرُهما ١٩ نوفمبر ٢٠٢٦):
 *    «مشكلة في التطبيق · مشكلة مع متجر · دفع/سعر  ⇐ complain@takisa.net
 *     اقتراح/تحسين · أخرى                        ⇐ info@takisa.net
 *     **وليس على nalaumari@gmail.com**».
 *
 * 🔴 **ولماذا لم يُنفَّذ أوّلَ مرّة**: v15.93 بنت التوجيهَ وشحنته — ولم تمسّ
 *    المسارَ القديم. فبقي `handle_new_complaint` يُرسل نسخةً ثانيةً إلى بريد
 *    **حساب** كلّ أدمن (`taki_queue_email` تقرأ `users.email`). والقياسُ على
 *    الإنتاج أثبته: شكويان، ولكلٍّ صفٌّ صحيحٌ في `complaint_mail` **وصفٌّ
 *    ثانٍ في `email_outbox` إلى الجيميل في نفس الثانية**.
 *    ⇒ الدرس: **إضافةُ قناةٍ صحيحة لا تُغلق القناةَ الخاطئة** — تُجرَد كلُّ
 *      المسارات التي تُنتج نفسَ الأثر، لا الذي أمامك.
 *
 * 🪤 والعيبُ الذي يحرسه هذا الفحص من اليوم: **نوعُ شكوى جديد في الواجهة بلا
 *    صندوقٍ في القاعدة**. قائمةُ السماح هناك صريحةٌ بلا `ELSE`، فالنوعُ غيرُ
 *    المذكور يُنتج صندوقاً `NULL` ⇒ **لا تُرسَل رسالةٌ إطلاقاً**، ويُسجَّل خطأٌ
 *    في جدولٍ لا يقرؤه أحد. يمرُّ البناءُ أخضرَ وتضيع شكاوى.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nتوجيهُ الشكاوى إلى صناديقها');

// ── ① أنواعُ الشكوى كما تعرضها الشاشة ───────────────────────────────────
const dlg = R('src/components/ComplaintDialog.tsx');
const uiKeys = [...dlg.matchAll(/\{\s*key:\s*'([a-z_]+)'/g)].map(m => m[1]);
check(`الشاشةُ تعرض ${uiKeys.length} أنواع`, uiKeys.length >= 5, uiKeys.join(' · '));

// ── ② وخريطةُ الصناديق في الهجرة ────────────────────────────────────────
const mig = R('supabase/JEDDAH_v15_93_complaint_mail_routing.sql');
const box = Object.fromEntries(
    [...mig.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'(complain|info)'/g)].map(m => [m[1], m[2]]));

// 🔴 ما أمر به ناصر حرفاً — وهذا هو العقد، لا ما في الكود
const WANT = {
    app_issue:   'complain',   // مشكلة في التطبيق
    store_issue: 'complain',   // مشكلة مع متجر
    payment:     'complain',   // دفع / سعر
    suggestion:  'info',       // اقتراح / تحسين
    other:       'info',       // أخرى
};
for (const [k, want] of Object.entries(WANT)) {
    check(`«${k}» ⇐ ${want}@`, box[k] === want,
        `المقيس: ${box[k] || '(بلا صندوق)'} — ونوعٌ بلا صندوق لا تُرسَل شكواه إطلاقاً`);
}

// ── ③ 🔴 ولا نوعَ في الشاشة بلا صندوق — هذا جوهرُ الحارس ────────────────
const orphans = uiKeys.filter(k => !box[k]);
check('ولا نوعَ في الشاشة بلا صندوقٍ في القاعدة', orphans.length === 0,
    orphans.join(' · ') + ' ⇐ أضِفه إلى `v_box` وإلّا ضاعت شكاواه بصمت');

// ── ④ ولا نسخةَ بريدٍ ثانيةً إلى حساب الأدمن ────────────────────────────
//    🪤 يُقاس على **كلّ** ملفّات الهجرة لا على الأخيرة: نصُّ الدالّة قد يعود
//       في أيّ ملفٍّ لاحق.
const sqlDir = path.join(root, 'supabase');
// 🪤 **وهذا الفحصُ أمسك تعليقَه هو أوّلَ مرّة** (الفخُّ المسجَّل، تاسعةً في
//    هذا المشروع): كتبتُ في الهجرة شرحاً يذكر `taki_queue_email` فاتّهمها.
//    ⇒ يُجرَّد تعليقُ `--` قبل أيّ بحث.
// 🪤 وأمسكتُ فيه خطأً ثانياً: الحدُّ كان `$function$` وحده، وملفُّ v14.33
//    يستعمل `$$` — فانزلق السلخُ إلى آخر الملفّ وقاس ما ليس من الدالّة.
const noSqlComments = (s) => s.replace(/--[^\n]*/g, '');
const bodyOfFn = (src, name) => {
    const at = src.indexOf(`FUNCTION public.${name}`);
    if (at === -1) return '';
    const open = /\$(function)?\$/.exec(src.slice(at));
    if (!open) return '';
    const tag = open[0];
    const start = at + open.index + tag.length;
    const end = src.indexOf(tag, start);
    return src.slice(start, end === -1 ? src.length : end);
};
const reAdders = fs.readdirSync(sqlDir)
    .filter(f => f.endsWith('.sql'))
    .filter(f => noSqlComments(bodyOfFn(fs.readFileSync(path.join(sqlDir, f), 'utf8'),
                                        'handle_new_complaint')).includes('taki_queue_email'));
check('ولا هجرةَ تُعيد بريدَ حساب الأدمن إلى `handle_new_complaint`',
    reAdders.length === 0, reAdders.join(' · '));

// ── ⑤ وعنوانا الصندوقين لا يُكتبان بيدٍ في الكود ────────────────────────
//    (يُقرآن من `platform_settings.contact_emails`، فيبدّلهما ناصر بلا نشر.)
check('والعنوانان يُقرآن من الإعدادات لا من نصٍّ مكتوب',
    /value\s*->>\s*v_box/.test(mig) && !/complain@takisa\.net'/.test(mig),
    'عنوانٌ مكتوبٌ في الكود يحتاج نشرةً كاملةً لتغييره');

console.log(`\n${fail ? '❌' : '✅'} توجيهُ الشكاوى: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
