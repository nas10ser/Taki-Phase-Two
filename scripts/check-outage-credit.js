#!/usr/bin/env node
/**
 * check-outage-credit.js — تعويضُ الأعطال (v16.54)
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① 🔴 **الأيّامُ تَدهس بدل أن تُضيف.** هذا عيبُ `grant_subscription_bulk`
 *    بعينه (`current_period_start = now()`): تاجرٌ له عشرون يوماً باقية ثمّ
 *    «تعويضُ» سبعةِ أيّام ⇒ **يخسر ثلاثةَ عشر**. والعلاجُ `GREATEST`.
 * ② 🔴 **ضغطتان ⇒ تعويضان.** بلا مفتاحِ تكرارٍ وفهرسٍ فريد يُمنح التعويضُ
 *    مرّتين — ومفتاحٌ يُولَّد **عند الضغط** لا عند فتح النموذج لا يحمي شيئاً.
 * ③ 🔴 **صلاحيةٌ مدموجة.** `action_view_finance` **قراءةُ** ماليّات؛ منحُ
 *    «اطّلِع على الأرقام» يجب ألّا يمنح «عوِّض كلَّ التجّار».
 * ④ 🔴 **ادّعاءُ ردٍّ لم يقع.** تاكي لم تستقبل ريالاً من تاجرٍ قطّ (مسارُ
 *    الدفع محاكاة)، فالمبلغُ يُسجَّل **مستحقّاً** ولا يُختم «حُوِّل» إلّا
 *    بمرجع. وقولُ «رُدّ» قبل ذلك وعدٌ بما لم يُنفَّذ (درس v14.82).
 * ⑤ **المعاينةُ والتنفيذُ من قائمتين.** لو بنى كلٌّ قائمتَه لرأى ناصر رقماً
 *    ونُفِّذ على آخر — قرارٌ بُني على رقمٍ كاذب.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذا الملفُّ وما يفحصه يذكران نفسَ
 *    الأسماء (وقع الفخُّ تسعَ مرّاتٍ في هذا المشروع).
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

const MIG = stripSql(R('supabase/JEDDAH_v16_54_outage_credits.sql'));
const UI  = strip(R('src/pages/admin/AdminOutageCredits.tsx'));
const REPO = strip(R('src/repositories/outageCreditRepository.ts'));

console.log('\nتعويضُ الأعطال — الأيّامُ تُضاف · والضغطةُ واحدة · والردُّ لا يُدَّعى');

// ── ① الأيّامُ تُضاف لا تَدهس ─────────────────────────────────────────────
check('الأيّامُ تُضاف فوق الرصيد الباقي (GREATEST)',
    /v_after\s*:=\s*GREATEST\(COALESCE\(v_before,\s*now\(\)\),\s*now\(\)\)/.test(MIG),
    'بلا GREATEST يخسر تاجرٌ له رصيدٌ باقٍ فرقَ ما بينهما — وهو عيبُ grant_subscription_bulk');
check('وتُكتب في المصدر الحاكم `store_profiles`',
    /UPDATE public\.store_profiles[\s\S]{0,120}?subscription_expires_at = v_after/.test(MIG),
    'قِيس أن `store_profiles.subscription_expires_at` يقرؤه ٢٠ دالّةً، والجدولان لا يتزامنان');
check('ولا يُنشأ صفٌّ في المرآة لمن لا صفَّ له',
    !/INSERT INTO public\.merchant_subscriptions/.test(MIG),
    'إنشاءُ صفٍّ هناك يخترع اشتراكاً لم يوجد (متجرُ ناصر بلا صفّ — قِيس)');

// ── ② مفتاحُ التكرار ─────────────────────────────────────────────────────
check('مفتاحُ التكرار إلزاميّ',
    /BATCH_KEY_REQUIRED/.test(MIG),
    'بلا مفتاحٍ لا ضمانَ ضدّ ضغطتين');
check('وفهرسٌ فريدٌ على (الدفعة × التاجر)',
    /CREATE UNIQUE INDEX[\s\S]{0,80}?idx_oc_batch_merchant[\s\S]{0,80}?\(batch_id, merchant_id\)/.test(MIG),
    'الفهرسُ هو ما يُحوّل المفتاحَ إلى حمايةٍ فعليّة');
check('والإدراجُ يتجاوز المكرّر بدل أن يفشل',
    /ON CONFLICT \(batch_id, merchant_id\) DO NOTHING/.test(MIG),
    'بلا ذلك تسقط الدفعةُ كلُّها عند أوّل مكرّر');
check('🔴 والواجهةُ تولّد المفتاحَ عند فتح النموذج لا عند الضغط',
    /useState\(\(\) =>\s*\n?\s*`\$\{Date\.now\(\)\}/.test(UI),
    'مفتاحٌ يُولَّد داخل `grant()` يعني مفتاحاً جديداً لكلّ ضغطة — أي لا حمايةَ أصلاً، '
    + 'وهو الشكلُ الذي يبدو فيه الحارسُ قائماً وهو عاطل');

// ── ③ الصلاحية ──────────────────────────────────────────────────────────
check('الصلاحيةُ مستقلّةٌ `action_grant_credit`',
    /taki_admin_perm\('action_grant_credit'\)/.test(MIG),
    'فعلٌ يُخرج قيمةً لا يُمنح ضمن «قراءة الماليّات»');
check('ولا تُستعمل `is_admin()` ولا حارسُ «أيُّ أدمن»',
    !/is_admin\(\)/.test(MIG) && !/user_type\s*(=|IS DISTINCT FROM)\s*'admin'/.test(MIG),
    '`is_admin()` تُرجع TRUE لأيّ أدمنٍ عند النداء المباشر (ثغرةُ v14.38)، '
    + 'وحارسُ «أيُّ أدمن» يفتحها لكلّ أدمنٍ فرعيّ (عيبُ grant_subscription_bulk)');
check('وهي في الكتالوج بموضع فرضها',
    /action_grant_credit/.test(strip(R('src/data/adminPermissions.ts')))
    && /action_grant_credit/.test(strip(R('src/services/authService.ts'))),
    'مفتاحٌ خارج الكتالوج لا يستطيع الأدمنُ الأعلى منحَه لأحد');
check('والتبويبُ محكومٌ بها',
    /id: 'credits'[\s\S]{0,260}?permission: 'action_grant_credit'/.test(strip(R('src/data/adminNav.ts'))),
    'شاشةٌ بلا `permission` يراها كلُّ أدمن');

// ── ④ لا يُدَّعى ردٌّ لم يقع ──────────────────────────────────────────────
check('المبلغُ يُسجَّل «مستحقّاً» لا «مدفوعاً»',
    /'cash', round\(p_amount,2\), 'pending_cash'/.test(MIG),
    'ختمُ «مدفوع» عند الضغط يَعِد التاجرَ بما لم يقع');
check('والختمُ يشترط مرجعاً',
    /REF_REQUIRED/.test(MIG),
    '«حُوِّل» بلا مرجعٍ ادّعاءٌ لا إثبات، والتاجرُ يحتاج ما يراجع به بنكَه');
check('وهو خاملُ التكرار',
    /IF r\.status = 'paid' THEN[\s\S]{0,140}?'already', true/.test(MIG),
    'إعادةُ إرسالٍ بعد ختمٍ ناجحٍ تُصدر إشعاراً ثانياً للتاجر');
check('والشاشةُ تقول صراحةً إنه لا يُخصم شيءٌ الآن',
    /لا يُخصم شيءٌ من أيّ حساب الآن/.test(UI),
    'وعدٌ غامضٌ عن مالٍ أسوأُ من لا وعد (درس v14.82)');

// ── ⑤ المعاينةُ من نفس قائمة التنفيذ ─────────────────────────────────────
check('المعاينةُ والتنفيذُ يقرآن `taki_outage_scope` نفسَها',
    (MIG.match(/FROM public\.taki_outage_scope\(/g) || []).length >= 3,
    'قائمتان تنحرفان ⇒ رقمٌ يُعرض وآخرُ يُنفَّذ');
check('ونطاقُ الاختيار ليس سطحاً عامّاً',
    /REVOKE ALL ON FUNCTION public\.taki_outage_scope\(text, text\[\]\) FROM PUBLIC, anon, authenticated/.test(MIG),
    'كشفُها لـ`authenticated` تسريبُ قائمة التجّار وتواريخ اشتراكاتهم');
check('والمجموعُ يُحسب على الخادم',
    /'total_amount'/.test(MIG) && /totalAmount/.test(REPO),
    'رقمٌ يُقرَّر عليه لا يُؤتمن عليه المتصفّح');

// ── ⑥ حدودٌ وسجلّ ───────────────────────────────────────────────────────
check('حدُّ المعدّل قبل أيّ أثر',
    /taki_rate_check\('outage:'[\s\S]{0,200}?v_batch :=/.test(MIG),
    'الحدُّ بعد الأثر ليس حدّاً');
check('والسجلُّ بلا سياسةِ كتابةٍ ولا DML',
    /REVOKE ALL ON public\.outage_credits FROM authenticated/.test(MIG)
    && !/CREATE POLICY[\s\S]{0,120}?outage_credits[\s\S]{0,60}?FOR (INSERT|UPDATE|DELETE)/.test(MIG),
    'سجلٌّ ماليٌّ يُعدَّل من المتصفّح ليس سجلّاً');
check('والتاجرُ يرى تعويضاتِه هو',
    /CREATE POLICY oc_select_own[\s\S]{0,200}?merchant_id = \(SELECT auth\.uid\(\)\)::text/.test(MIG),
    'بلا ذلك لا يعرف التاجرُ لماذا امتدّ اشتراكُه');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
