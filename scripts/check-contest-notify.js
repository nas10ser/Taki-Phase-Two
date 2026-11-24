#!/usr/bin/env node
/**
 * check-contest-notify.js — إشعارُ الفائز بيد الأدمن (v16.55)
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① 🔴 **عودةُ الإشعار التلقائيّ إلى السحب.** أمرُ ناصر: بعضُ شروط المسابقة
 *    لا تُفحص آلياً (أن يضع حسابه في التواصل · أن يكون متابِعاً)، فتهنئةٌ
 *    تصل لحظةَ السحب تسبق التحقّق — ولا تُسحب بعد وصولها.
 * ② 🔴 **ختمُ «أُشعر» لمن لا يصله شيء.** فائزٌ شارك بلا حساب لا صندوقَ
 *    إشعاراتٍ له؛ وختمُ الأثر له يُسكت الزرَّ عن شخصٍ لم يُبلَّغ أبداً.
 * ③ 🔴 **ضغطتان ⇒ تهنئتان.** `notified_at` + القفل هما ما يمنع ذلك.
 * ④ 🔴 **`is_admin()` في دوال المسابقات**: تُرجع TRUE لأيّ أدمنٍ عند النداء
 *    المباشر (ثغرةُ v14.38) ⇒ أدمنٌ فرعيٌّ يسحب الفائزين ويُلغيهم.
 * ⑤ **زرُّ «أشعِر الجميع»** يُعيد المسارَ التلقائيَّ بخطوةٍ إضافية ويُلغي
 *    سببَ الطلب كلَّه — فلا يُضاف.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذا الملفُّ وما يفحصه يذكران نفسَ
 *    الأسماء.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const stripSql = (src) => src.replace(/^\s*--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

const MIG  = stripSql(R('supabase/JEDDAH_v16_55_contest_manual_notify.sql'));
const UI   = strip(R('src/pages/admin/AdminContests.tsx'));
const REPO = strip(R('src/repositories/contestRepository.ts'));

console.log('\nإشعارُ الفائز — بيد الأدمن لا تلقائياً');

// ── ① السحبُ لا يُشعر ────────────────────────────────────────────────────
{
    // جسمُ `draw_contest_winners` وحده — لا الملفُّ كلُّه (نمطٌ يمسح الملفَّ
    // كان سيلتقط دالّةَ الإشعار المشروعة أدناه ويُعلنها عيباً).
    const m = /CREATE OR REPLACE FUNCTION public\.draw_contest_winners[\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(MIG);
    check('مصدرُ السحب مقروء', !!m, 'تغيّرت بنيةُ الهجرة — راجِع الحارس');
    check('السحبُ لا يُدرج إشعاراً',
        !!m && !/INSERT INTO (public\.)?notifications/.test(m[1]),
        'عاد الإشعارُ التلقائيّ إلى السحب — وهو ما طلب ناصر فصلَه');
    check('ويُعلن أن الإشعار يدويّ',
        !!m && /'manual_notify', true/.test(m[1]),
        'المنادي يقرأ `notified`؛ وحذفُ البيان يجعل الشاشةَ تصمت عن السبب');
}

// ── ② ولا ختمَ لمن لا حسابَ له ──────────────────────────────────────────
{
    const m = /CREATE OR REPLACE FUNCTION public\.admin_notify_contest_winner[\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(MIG);
    check('دالّةُ الإشعار موجودة', !!m, 'لم أجدها في الهجرة');
    const body = m ? m[1] : '';
    // 🪤 في الدالّة **كتلتان** `IF v_uid IS NULL`: الأولى تبحث بالجوال
    //    والثانيةُ ترفض. ونمطٌ يأخذ أوّلَ مطابقةٍ كان يلتقط الأولى فيُعلن
    //    عيباً لا وجودَ له — سلبيّةٌ كاذبة أمسكها هذا الحارسُ في نفسه.
    //    ⇒ يُقتطع ما **يسبق** `NO_ACCOUNT` مباشرةً ويُفحص.
    const atNoAcc = body.indexOf('NO_ACCOUNT');
    const before = atNoAcc > -1 ? body.slice(Math.max(0, atNoAcc - 300), atNoAcc) : '';
    check('بلا حسابٍ ⇒ يُقال صراحةً ولا يُختم الأثر',
        atNoAcc > -1 && /IF v_uid IS NULL THEN/.test(before) && !/UPDATE/.test(before),
        'ختمُ `notified_at` لمن لا صندوقَ له يُسكت الزرَّ عن فائزٍ لم يُبلَّغ');
    check('وخاملُ التكرار قبل أيّ إدراج',
        body.indexOf('notified_at IS NOT NULL') > -1
        && body.indexOf('notified_at IS NOT NULL') < body.indexOf('INSERT INTO public.notifications'),
        'بلا هذا الفحص — أو بعد الإدراج — تصل الفائزَ تهنئتان');
    check('وقفلٌ على الصفّ قبل قراءته',
        /FROM public\.contest_entries WHERE id = p_entry_id FOR UPDATE/.test(body),
        'ضغطتان متزامنتان تقرآن `notified_at` الفارغ معاً');
    check('ويشترط أنه فائزٌ فعلاً',
        /NOT e\.is_winner[\s\S]{0,80}?NOT_WINNER/.test(body),
        'إشعارُ فوزٍ لغير فائز');
}

// ── ③ الحارس: لا `is_admin()` في دوال المسابقات ─────────────────────────
check('دوالُّ المسابقات تحرسها `taki_admin_perm` لا `is_admin()`',
    /taki_admin_perm\('tab_contests'\)/.test(MIG)
    && !/NOT public\.is_admin\(\)/.test(MIG),
    '`is_admin()` تُرجع TRUE لأيّ أدمنٍ عند النداء المباشر (v14.38)');
check('والهجرةُ تُصحّح السحبَ والإلغاءَ معاً',
    /admin_reset_contest_winners/.test(MIG) && /admin_custom_draw/.test(MIG),
    'تصحيحُ واحدةٍ يترك الأخرى مفتوحةً لأدمنٍ فرعيّ');

// ── ④ الواجهة ───────────────────────────────────────────────────────────
check('زرُّ «أرسل إشعاراً» بجانب كلّ فائز',
    /onClick=\{\(\) => notifyWinner\(w\)\}/.test(UI) && /أرسل إشعاراً/.test(UI),
    'لا زرَّ ⇒ لا سبيلَ لإشعار فائزٍ إطلاقاً بعد إيقاف التلقائيّ');
check('ويُعطَّل بعد الإشعار',
    /disabled=\{notifyingId === w\.id \|\| !!w\.notified_at\}/.test(UI),
    'زرٌّ يبقى نشطاً بعد الإرسال يدعو لضغطةٍ ثانية');
check('والتاريخُ مكتوبٌ تحت البطاقة لا في `title` وحده',
    /🔔 أُشعر \{new Date\(w\.notified_at\)/.test(UI),
    'ناصر يعمل من الجوّال حيث لا تمرير فأرة — ما في `title` لا يُقرأ (درس v14.89)');
check('وتأكيدٌ قبل الإرسال',
    /customConfirm\([\s\S]{0,200}?إرسال إشعار الفوز/.test(UI),
    'إشعارٌ يصل صندوقَ الفائز ولا يُسحب بعدها');
check('🪤 ولا زرَّ «أشعِر الجميع»',
    !/notifyAllWinners|أشعِر الجميع|إشعار الجميع/.test(UI),
    'زرُّ الكلّ يُعيد المسارَ التلقائيَّ بخطوةٍ إضافية ويُلغي سببَ الطلب');

// ── ⑤ المستودع ─────────────────────────────────────────────────────────
check('المستودعُ يفحص `ok !== true` لا غيابَ الخطأ',
    /d\?\.ok !== true/.test(REPO),
    '`ok:false` يصل بـ`error=null` — فمن يفحص الخطأ وحده يقول «أُرسل» عن لا شيء');
check('ونصُّ الرموز في مكانٍ واحد',
    /WINNER_NOTIFY_ERRORS/.test(REPO) && /NO_ACCOUNT:/.test(REPO),
    'رسالةٌ تُخترع في الشاشة تنحرف عن رمز الخادم');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
