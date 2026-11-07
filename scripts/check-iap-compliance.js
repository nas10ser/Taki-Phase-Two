#!/usr/bin/env node
/**
 * check-iap-compliance.js — البندُ ٣٫١٫١ لا يُترك لذاكرة أحد (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * أبل تُلزم بنظام دفعها لأيّ خدمةٍ رقميّة تُشترى في التطبيق، **وتمنع حتى
 * الإحالةَ** إلى شراءٍ خارجه. وقوقل تُلزم بالمِثل. وعقوبةُ المخالفة ليست
 * تحذيراً: رفضُ النشرة، وقد يتكرّر أسابيع.
 *
 * 🔴 وهذا من صنف العيوب التي **لا يكشفها أيّ اختبارٍ وظيفيّ**: التطبيقُ
 *    يعمل، والزرُّ يعمل، والمراجعُ وحده يرفض. فيلزم حارسٌ في سلسلة البناء.
 *
 * 🪤 ولا يُفحص بكلمةٍ مفتاحيّة: `initiateMoyasarPayment` موجودٌ في الملفّ
 *    بطبيعته (تعريفُ الدالّة لمسار الويب)، ووجودُه ليس مخالفة. والعقدُ
 *    **بنيويّ**: الخروجُ المبكّر `if (iapIsStoreFlow())` يجب أن يسبق كلَّ
 *    موضعِ تصييرٍ يستدعي مسارَ البوّابة — فلا يُصيَّر أصلاً في التطبيق.
 *    (وقياسي الأوّل قارن بموضع **تعريف** الدالّة فاتّهم كوداً سليماً.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const F = path.join(ROOT, 'src', 'pages', 'Subscription.tsx');
const fail = (m) => { console.error('❌ ' + m); process.exit(1); };

if (!fs.existsSync(F)) fail('src/pages/Subscription.tsx غير موجود.');
const s = fs.readFileSync(F, 'utf8');

// ١) الخروجُ المبكّر موجود.
const iGate = s.indexOf('if (iapIsStoreFlow())');
if (iGate < 0) {
    fail('لا خروجَ مبكّراً `if (iapIsStoreFlow())` في صفحة الاشتراك —\n'
       + '   فمسارُ البوّابة سيُصيَّر داخل التطبيق، ويُرفض بالبند ٣٫١٫١.');
}

// ٢) ويسبق **كلَّ** موضعِ تصييرٍ يستدعي الدفعَ الخارجيّ.
//    (الأنماطُ مواضعُ تصييرٍ لا تعريفات: مُعالِجُ حدثٍ في JSX.)
const RENDER_SITES = [
    /onClick=\{\s*handleSubscribe\s*\}/g,
    /onClick=\{\s*\(\s*\)\s*=>\s*handleSubscribe/g,
    /onClick=\{\s*\(\s*\)\s*=>\s*paymentService\./g,
];
let found = 0;
for (const re of RENDER_SITES) {
    for (const m of s.matchAll(re)) {
        found++;
        if (m.index < iGate) {
            fail(`موضعُ تصييرٍ للدفع الخارجيّ (${m[0].trim()}) يسبق الخروجَ المبكّر —\n`
               + '   فسيظهر داخل التطبيق ويُرفض بالبند ٣٫١٫١.');
        }
    }
}
// 🪤 وصفرُ موضعٍ ليس نجاحاً: يعني أن النمطَ تخلّف عن إعادةِ كتابةٍ للصفحة،
//    فيصير الحارسُ أخضرَ دائماً وهو لا يحرس شيئاً. (درسُ «الفحوص التي لا
//    تستطيع الفشل» — ونفسُ منطق «غير موجود ليس نجاحاً» في الفحص الأمنيّ.)
if (found === 0) {
    fail('لم يُعثر على أيّ موضعِ تصييرٍ لمسار البوّابة في صفحة الاشتراك.\n'
       + '   إن أُزيل مسارُ الويب عمداً فيُحدَّث هذا الحارس؛ وإلّا فالنمطُ تخلّف\n'
       + '   عن تعديلٍ في الصفحة وصار الحارسُ أخضرَ بلا أن يحرس شيئاً.');
}

// ٣) ولوحةُ المتجر تحمل ما يُلزم به البندُ ٣٫١٫٢: الاستعادةُ والإفصاح.
const P = path.join(ROOT, 'src', 'components', 'seller', 'StoreSubscription.tsx');
if (!fs.existsSync(P)) fail('src/components/seller/StoreSubscription.tsx غير موجود.');
const p = fs.readFileSync(P, 'utf8');
// 🔴 والعلاماتُ **تعابيرُ نمطيّةٌ بحدودِ كلمات، لا نصوصٌ مُضمَّنة.** جُرِّب
//    الحارسُ مكسوراً فمرّ كاذباً: أُعيدت تسميةُ `iapRestore` إلى
//    `iapRestore_gone` و`'iapRestore_gone'.includes('iapRestore')` **صحيح** —
//    فبقي الحارسُ أخضرَ وزرُّ الاستعادة مكسور. والعقدُ الصحيح: **نداءٌ**
//    بحدودِ كلمةٍ (`\biapRestore\s*\(`)، و**وسمٌ** للرابط لا مسارٌ عارٍ.
const MUST = [
    [/\biapRestore\s*\(/, 'نداءُ «استعادة المشتريات» — يُلزم به البند ٣٫١٫١ لكل اشتراكٍ متجدّد'],
    [/to=["']\/terms["']/, 'رابطُ الشروط — يُلزم به البند ٣٫١٫٢ على شاشة الشراء'],
    [/to=["']\/privacy["']/, 'رابطُ الخصوصية — يُلزم به البند ٣٫١٫٢ على شاشة الشراء'],
    [/\bpriceLabel\b/, 'السعرُ من المتجر — لا يُصاغ عندنا ولا تُضاف عليه ضريبة'],
];
for (const [re, why] of MUST) {
    if (!re.test(p)) fail(`ناقصٌ في لوحة المتجر: ${why}\n   (المطلوب نمطُ ${re})`);
}
// ٤) ولا يُعرض سعرٌ نحسبه نحن بجوار سعر المتجر — تناقضٌ يراه المستخدم.
for (const bad of ['vatOnTop', 'effectivePrice', 'fmtSAR']) {
    if (new RegExp('\\b' + bad + '\\s*\\(').test(p)) {
        fail(`لوحةُ المتجر تستعمل «${bad}» — السعرُ هنا من المتجر وحده،\n`
           + '   وعرضُ رقمٍ يخالف ما يقوله المتجر مخالفةُ البند ٣٫١٫٢.');
    }
}

console.log(`✅ امتثالُ الشراء داخل التطبيق: الخروجُ المبكّر يسبق ${found} موضعَ تصييرٍ للبوّابة`
          + ' · والاستعادةُ والإفصاحُ والسعرُ من المتجر قائمة (٤ فحوص)');

// ═══════════════════════════════════════════════════════════════════════════
// ٥) الإقرار/الإنهاء — في الثلاثة معاً
// ───────────────────────────────────────────────────────────────────────────
// 🔴 غيابُه **يُلغي البيع بلا أيّ رسالة**: قوقل تستردّ مالَ شراءٍ لم يُقَرّ
//    خلال ثلاثة أيّام وتُلغي الاشتراك، وأبل تُعيد تسليمَ معاملةٍ لم تُنتهَ
//    عند كل إقلاع. والعيبُ لا يظهر في أيّ اختبار: الشراءُ ينجح والاشتراكُ
//    يُفعَّل ثمّ يتبخّر بعد ثلاثة أيّام.
// 🪤 ويُفحص في **ثلاثة ملفّات**: الجسرُ ينادي، والمنصّتان تُنفّذان. ونقصُ
//    واحدٍ يُنتج منصّةً تعمل وأخرى تخسر المالَ صامتةً.
{
    const FILES = [
        // 🔴 والنمطُ **نداءُ عضوٍ** (`.finalizePurchase(`) لا الاسمَ وحده:
        //    `finalizePurchase(o: {…}): Promise<unknown>;` في تصريح الواجهة
        //    يُطابق `/finalizePurchase\s*\(/` بذاته، فحذفُ **النداء الوحيد**
        //    كان يمرّ أخضرَ (أُثبت بالتنفيذ). والتصريحُ بلا نقطةٍ سابقة
        //    والنداءُ بها — فهي الفارقُ الوحيد الذي لا يُلتبس.
        [path.join(ROOT, 'src/native/iap.ts'), /[.?]\s*finalizePurchase\s*\(/,
         'جسرُ الويب لا ينادي الإقرار بعد التحقّق (تصريحُ الواجهة لا يكفي)'],
        [path.join(ROOT, 'android/app/src/main/java/net/takisa/app/TakiIapPlugin.java'),
         /acknowledgePurchase\s*\(/,
         'إضافةُ أندرويد لا تُقِرّ الشراء — قوقل تستردّ المالَ بعد ثلاثة أيّام'],
        [path.join(ROOT, 'ios/App/App/TakiIapPlugin.swift'), /await\s+txn\.finish\(\)/,
         'إضافةُ آيفون لا تُنهي المعاملة — تُعاد تسليمُها إلى الأبد'],
    ];
    for (const [f, re, why] of FILES) {
        if (!fs.existsSync(f)) fail(`ملفٌّ ناقص: ${path.relative(ROOT, f)}`);
        if (!re.test(fs.readFileSync(f, 'utf8'))) fail(`${why}\n   (المطلوب نمطُ ${re})`);
    }
    // ٦) وملفُّ Swift مسجَّلٌ في مرحلة Sources — وإلّا لم يُترجَم إطلاقاً.
    const pbx = path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');
    if (fs.existsSync(pbx)) {
        const t = fs.readFileSync(pbx, 'utf8');
        const i = t.indexOf('isa = PBXSourcesBuildPhase');
        const j = t.indexOf('/* End PBXSourcesBuildPhase section */');
        const inSources = i >= 0 && j > i
            && t.slice(i, j).includes('TakiIapPlugin.swift in Sources');
        if (!inSources) {
            fail('TakiIapPlugin.swift ليس في مرحلة Sources من مشروع Xcode —\n'
               + '   فلن يُترجَم إطلاقاً، والبناءُ ينجح أخضرَ وأوّلُ نداءٍ يردّ «غير منفَّذة».\n'
               + '   يُصلَح بـ: node scripts/ios-project-patch.js');
        }
    }
    // ٧) وتسجيلُ الإضافة في أندرويد يسبق super.onCreate.
    const ma = path.join(ROOT, 'android/app/src/main/java/net/takisa/app/MainActivity.java');
    if (fs.existsSync(ma)) {
        // 🪤 **تُجرَّد التعليقاتُ قبل الفحص.** وقع فعلاً: التعليقُ الذي يشرح
        //    «التسجيلُ قبل super.onCreate» يحوي العبارةَ نفسَها ويسبقها، فاتّهم
        //    الحارسُ كوداً سليماً. وهو فخٌّ تكرّر في هذا المشروع أربع مرّات —
        //    أيُّ فحصٍ بموضعٍ نصّيّ يُجرّد التعليقَ أوّلاً، بلا استثناء.
        const t = fs.readFileSync(ma, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        if (!/registerPlugin\s*\(\s*TakiIapPlugin\.class\s*\)/.test(t)) {
            fail('TakiIapPlugin غيرُ مسجَّلٍ في MainActivity — الـWebView لن يراه.');
        }
        // 🔴 ويُستعمل **نفسُ النمط المتسامح** لتحديد الموضع. كان الوجودُ
        //    يُفحص بـ`/registerPlugin\s*\(…\)/` والترتيبُ بـ`indexOf` على
        //    حرفيّةٍ بلا فراغ — فمسافةٌ واحدة تجعل `indexOf` يردّ `-1`،
        //    و`-1 > sup` خطأٌ دائماً ⇒ **فحصُ الترتيب يصير لا شيء، بصمت**.
        //    وهو الفحصُ الوحيد الذي يحمي مسارَ أندرويد من الموت الكامل.
        const mReg = /registerPlugin\s*\(\s*TakiIapPlugin\.class\s*\)/.exec(t);
        const mSup = /super\s*\.\s*onCreate\s*\(/.exec(t);
        const r = mReg ? mReg.index : -1;
        const sup = mSup ? mSup.index : -1;
        if (r < 0) fail('تعذّر تحديدُ موضع registerPlugin — تغيّرت البنيةُ فلا يُحكم عمياً.');
        if (sup >= 0 && r > sup) {
            fail('registerPlugin بعد super.onCreate — الجسرُ يُبنى داخل super،\n'
               + '   فتسجيلٌ بعده لا يراه الـWebView ويردّ «الإضافةُ غير موجودة».');
        }
    }
    console.log('✅ الإقرار/الإنهاء: الجسرُ + أندرويد + آيفون · والتسجيلُ في المشروعين (٤ فحوص)');
}

// ═══════════════════════════════════════════════════════════════════════════
// ٨) كلُّ نداءِ فوترةٍ في أندرويد تُقرأ نتيجتُه — **بوحدة الدالّة**
// ───────────────────────────────────────────────────────────────────────────
// 🔴 `queryPurchasesAsync` كان يتجاهل `BillingResult`: استعلامٌ فاشل يُسلّم
//    قائمةً فارغة فيردّ كائناً فارغاً — **مطابقاً تماماً** لـ«هذا الحساب لا
//    يملك اشتراكاً». فيُقال لتاجرٍ يملك اشتراكاً إنه لا يملكه، وهو الذي
//    يحتاج هذا الزرَّ بعينه (بدّل جهازه).
//
// 🪤 وهذا الحارسُ أُعيد **مرّتين** بعد قياسٍ كشف ثقبيه:
//    (أ) أوّلُه عدّ **المجموع** (١١ قراءةً مقابل ٣ مُستدعيات) فمُستدعىً فيه
//        ثلاثُ قراءاتٍ يُغطّي آخرَ بلا قراءة.
//    (ب) وثانيه قطّع «من مُستدعىً إلى الذي يليه» — فنَزَّ جسمُ `restore`
//        إلى `finalizePurchase` بعده (لامبدا `r -> {` بلا أقواس لا يراها
//        النمط) فابتلع قراءتَه ومرّ أخضرَ على كسرةٍ حقيقيّة. وثمّ مُستدعىً
//        رابعٌ باسم `result` كان **غيرَ مرئيٍّ أصلاً**.
//    ⇒ الوحدةُ الصحيحة **الدالّة**: أيُّ دالّةٍ تُنادي فوترةً غيرَ متزامنةٍ
//      يجب أن تقرأ النتيجةَ في جسمها هي. وأسماءُ المعاملات لا تُفترض.
{
    const f = path.join(ROOT, 'android/app/src/main/java/net/takisa/app/TakiIapPlugin.java');
    if (fs.existsSync(f)) {
        const t = fs.readFileSync(f, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        // نداءاتُ الفوترة غيرُ المتزامنة: كلٌّ منها يُسلّم BillingResult.
        const ASYNC = /(queryProductDetailsAsync|queryPurchasesAsync|acknowledgePurchase|startConnection)\s*\(/;
        // الوحداتُ: دوالُّ الإضافة + حقلُ المُستدعى العامّ (listener).
        const units = [];
        // 🪤 وحدودُ الوحدة تُقاس **بعمق الأقواس**: تصريحُ دالّةٍ داخل صنفٍ
        //    مجهولٍ (`new BillingClientStateListener() { @Override public void
        //    onBillingSetupFinished(…) }`) يطابق نمطَ الدالّة، فيبدأ وحدةً
        //    جديدةً **تقطع جسمَ حاضنتها قبل قراءتها** — واتُّهمت `withClient`
        //    بالعمى وهي تقرأ النتيجةَ فعلاً. والدالّةُ الحقيقيّة وحدها على
        //    عمق ١ (جسمُ الصنف)، وما دونها جزءٌ من حاضنته.
        const depthAt = (idx) => {
            let d = 0;
            for (let x = 0; x < idx; x++) {
                const c = t[x];
                if (c === '{') d++; else if (c === '}') d--;
            }
            return d;
        };
        const reMethod = /(?:public|private)\s+(?:void|[A-Za-z<>,\s\[\]]+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
        const marks = [...t.matchAll(reMethod)]
            .filter((m) => depthAt(m.index) === 1)
            .map((m) => ({ name: m[1], at: m.index }));
        const reField = /private\s+final\s+PurchasesUpdatedListener\s+(\w+)\s*=/g;
        for (const m of t.matchAll(reField)) marks.push({ name: m[1], at: m.index });
        marks.sort((a, b) => a.at - b.at);
        for (let k = 0; k < marks.length; k++) {
            units.push({
                name: marks[k].name,
                body: t.slice(marks[k].at, k + 1 < marks.length ? marks[k + 1].at : t.length),
            });
        }
        if (!units.length) fail('لم تُقرأ بنيةُ إضافة أندرويد — يُحدَّث الحارس، ولا يُحكم عمياً.');

        const blind = [];
        let checked = 0;
        for (const u of units) {
            // وحدةٌ تستلم نتيجةَ فوترةٍ: إمّا تُنادي نداءً غيرَ متزامن، أو
            // هي المُستدعى العامّ (يستلم BillingResult دائماً).
            const takesResult = ASYNC.test(u.body) || /PurchasesUpdatedListener/.test(u.body);
            if (!takesResult) continue;
            checked++;
            if (!/\.\s*getResponseCode\s*\(\s*\)/.test(u.body)) blind.push(u.name);
        }
        if (!checked) fail('صفرُ وحدةٍ تستلم نتيجةَ فوترة — تغيّرت البنيةُ فلا يُحكم عمياً.');
        if (blind.length) {
            fail(`وحداتُ فوترةٍ لا تقرأ BillingResult: ${blind.join(' · ')}\n`
               + '   نداءٌ يتجاهل النتيجةَ يردّ "لا شيء" عن فشلٍ — وهو كذبٌ صامت.');
        }
        console.log(`✅ أندرويد: ${checked}/${checked} وحدةَ فوترةٍ تقرأ نتيجتَها`);
    }
}
