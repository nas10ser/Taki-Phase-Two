#!/usr/bin/env node
/**
 * check-release-contract.js — «أخضر» لا يعني «قابلٌ للرفع» (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **العيبُ المقيس، لا المفترض.** سيرُ آيفون: سبعُ جلسات، خطوتا التوقيع
 *    `skipped` **١٤/١٤ مرّة**، وجلستا ٧ نوفمبر ٢٠٢٦ (42365643717 ·
 *    42374499153) خضراوان تماماً و`artifacts total= 0`. وسيرُ أندرويد:
 *    `bundleRelease` مُخطّاة و`assembleDebug` ناجحة، فرُفع أثرٌ ٣١٫٧ م.ب هو
 *    حزمةُ **تصحيح** ترفضها قوقل. أي أن الأخضرَ كان يعني «جُمِّع» ولا شيءَ
 *    في المستودع يفرّقه عن «وصل المتجرَ».
 *
 * 🔴 **ولماذا حارسٌ في المستودع ولا يكفي العقدُ داخل السير**: العقدُ هناك
 *    (`.github/release-contract.sh`) يقرأ حالاتِ خطواتٍ **بمعرّفاتها**، و
 *    `steps.<معرّفٍ غيرِ موجود>.outcome` يُعطي **سلسلةً فارغة** لا خطأً.
 *    فحذفُ `id:` من خطوةٍ، أو إعادةُ تسميتها، يُبقي العقدَ أخضرَ وهو لا
 *    يقرأ شيئاً — وذاك بعينه صنفُ «الفحوص التي لا تستطيع الفشل». فهذا
 *    الملفُّ يُثبت الوصلَ: كلُّ معرّفٍ يقرؤه العقدُ **معلَنٌ فعلاً** في نفس
 *    المهمّة، والعقدُ نفسُه موصولٌ بـ`if: always()`.
 *
 * 🪤 وتُجرَّد التعليقاتُ قبل كلّ فحص. فخُّ «الحارسُ يتّهم تعليقَه هو» دُفع
 *    ثمنُه في هذا المشروع خمسَ مرّات — ومنها حارسٌ أمسك التعليقَ الذي
 *    يحذّر منه، وآخرُ أمسك إفصاحَنا المنفيّ.
 * 🪤 ويقرأ السيرَ **سطراً سطراً بمفتاحيه** لا بمحلّل YAML: لا تبعيّةَ جديدة،
 *    والبنيةُ المقروءة ضحلةٌ جداً (خطواتٌ ذاتُ `name`/`id`/`if`).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const notes = [];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripYamlComments = (t) => t.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
const stripGroovyComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// ═══════════════════════════════════════════════════════════════════════════
// ١) العقدُ موصولٌ في كلا السيرين، ومعرّفاتُه حقيقيّة
// ═══════════════════════════════════════════════════════════════════════════
const CONTRACT = '.github/release-contract.sh';
if (!fs.existsSync(path.join(ROOT, CONTRACT))) {
    problems.push(`${CONTRACT} غير موجود — لا عقدَ إصدارٍ إطلاقاً.`);
}

for (const wf of ['.github/workflows/build-ios.yml', '.github/workflows/build-android.yml']) {
    if (!fs.existsSync(path.join(ROOT, wf))) { problems.push(`${wf} غير موجود.`); continue; }
    const raw = read(wf);
    const y = stripYamlComments(raw);

    // ١أ) الخطوةُ التي تُشغّل العقد
    if (!y.includes(`bash ${CONTRACT}`)) {
        problems.push(`${wf} لا يُشغّل ${CONTRACT} — «أخضر» فيه لا يعني شيئاً.`);
        continue;
    }

    // ١ب) المعرّفاتُ المعلَنةُ فعلاً في الملفّ (`id: xxx`)
    const declared = new Set([...y.matchAll(/^\s*id:\s*([A-Za-z0-9_-]+)\s*$/gm)].map((m) => m[1]));
    if (!declared.size) problems.push(`${wf}: صفرُ معرّفِ خطوةٍ — لم تُقرأ بنيةُ السير، ولا يُحكم عمياً.`);

    // ١ج) المعرّفاتُ التي **يقرؤها** العقد: أزواجُ `اسم=${{ steps.X.outcome }}`
    //     🔴 ويُشترط تطابقُ الاسم المعروض مع المعرّف المقروء: زوجٌ يقول
    //        `archive=${{ steps.export.outcome }}` كان سيتّهم الخطوةَ الخطأ،
    //        فيُقرأ التقريرُ على أنه يفحص ما لا يفحص.
    const pairs = [...y.matchAll(/([A-Za-z0-9_]+)=\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outcome\s*\}\}/g)];
    if (!pairs.length) {
        problems.push(`${wf}: العقدُ لا يقرأ أيَّ حالةِ خطوة (CONTRACT_STEPS فارغة) — حارسٌ لا يحرس.`);
    }
    for (const [, label, id] of pairs) {
        if (label !== id) {
            problems.push(`${wf}: العقدُ يُسمّي «${label}» ويقرأ حالةَ «${id}» — تقريرٌ يتّهم الخطوةَ الخطأ.`);
        }
        if (!declared.has(id)) {
            problems.push(`${wf}: العقدُ يقرأ حالةَ خطوةٍ «${id}» غيرِ معلَنةٍ بـ\`id:\` — `
                + 'التعبيرُ يُعطي سلسلةً فارغة لا خطأً، فيبدو العقدُ عاملاً وهو أعمى.');
        }
    }
    notes.push(`${wf}: ${pairs.length} خطوةً مرصودةً من ${declared.size} معرّفاً معلَناً`);

    // ١د) و`if: always()` على خطوة العقد — حارسٌ يُخطَّى ليس حارساً.
    //     (قِيس في الجلسة 42312941466: كلُّ خطوةٍ بعد الفشل خُطّيت.)
    const ci = y.indexOf(`bash ${CONTRACT}`);
    const head = y.slice(Math.max(0, ci - 1400), ci);
    if (!/if:\s*always\(\)/.test(head)) {
        problems.push(`${wf}: خطوةُ العقد بلا \`if: always()\` — ستُخطَّى في الحالة التي يُراد لها أن تصرخ.`);
    }

    // ١هـ) ولا `if-no-files-found: ignore` في الملفّ كلِّه: هي بعينها التي
    //      جعلت جلسةً خضراء تُنتج صفرَ أثر.
    if (/if-no-files-found:\s*ignore/.test(y)) {
        problems.push(`${wf}: \`if-no-files-found: ignore\` — أثرٌ فارغٌ يمرّ بصمت، وهو عَرَضُ العيب نفسِه.`);
    }

    // ١و) وعقدُ المُخرَج مضبوطٌ (لا يُقاس الاتّجاه بل الملفّ)
    if (!/CONTRACT_ARTIFACT:/.test(y) || !/CONTRACT_ARTIFACT_GLOB:/.test(y)) {
        problems.push(`${wf}: العقدُ بلا CONTRACT_ARTIFACT/_GLOB — سينجح على نجاحِ خطواتٍ بلا ملفّ.`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ٢) توقيعُ آيفون يدويٌّ صِرف — والتناقضُ القديم لا يعود
// ═══════════════════════════════════════════════════════════════════════════
{
    const ios = stripYamlComments(read('.github/workflows/build-ios.yml'));
    // 🔴 `-allowProvisioningUpdates` أمرُ «اذهب إلى بوّابة أبل»، ويحتاج جلسةَ
    //    حسابٍ لا تملكها المنصّة — وكان مجموعاً مع ملفِّ تزويدٍ مركَّبٍ يدوياً.
    if (/-allowProvisioningUpdates/.test(ios)) {
        problems.push('build-ios.yml يحمل `-allowProvisioningUpdates` — توقيعٌ تلقائيٌّ يتجاهل '
            + 'ملفَّ التزويد المركَّب، ويحتاج جلسةَ حسابٍ غيرَ موجودةٍ على المنصّة.');
    }
    for (const [needle, why] of [
        ['CODE_SIGN_STYLE=Manual', 'أسلوبُ التوقيع اليدويّ صراحةً (المشروعُ يقول Automatic)'],
        ['PROVISIONING_PROFILE_SPECIFIER=', 'تحديدُ ملفّ التزويد (وبلاه يتجاهله xcodebuild)'],
        ['CODE_SIGN_IDENTITY=', 'دهسُ هويّة المشروع «iPhone Developer» — هويّةُ تطويرٍ لا تصلح للمتجر'],
        ['App.Release.entitlements', 'صلاحيّاتُ الإصدار (aps-environment = production)'],
        ['signingStyle', 'خريطةُ التوقيع في خطّة التصدير'],
        ['embedded.mobileprovision', 'الفرقُ الماديُّ الوحيد بين حزمةٍ موقَّعةٍ وغيرِها'],
        ['Authority=(Apple|iPhone) Distribution', 'إثباتُ أن التوقيعَ توقيعُ **توزيع**'],
        ['destination</key><string>upload', 'خطوةُ الرفع إلى App Store Connect'],
    ]) {
        if (!ios.includes(needle)) problems.push(`build-ios.yml ناقصٌ «${needle}» — ${why}.`);
    }
    // 🔴 وفحصُ الهويّات لا يجوز أن يعود إلى الصيغة التي لا تفشل:
    //    `find-identity | grep -c 'valid identities'` يعدّ سطرَ الخلاصة الذي
    //    تطبعه الأداةُ دائماً — فيطبع ١ على سلسلةٍ فارغة.
    if (/grep\s+-c\s+['"]valid identities/.test(ios)) {
        problems.push('build-ios.yml يعدّ «valid identities» — سطرُ خلاصةٍ يُطبع دائماً، '
            + 'فالفحصُ يقول ١ على سلسلةٍ فارغة. يُعدّ سطرُ الهويّة نفسُه.');
    }
    // وملفُّ صلاحيّات الإصدار موجودٌ فعلاً وقيمتُه production.
    const relEnt = 'ios/App/App/App.Release.entitlements';
    if (!fs.existsSync(path.join(ROOT, relEnt))) {
        problems.push(`${relEnt} غير موجود — الأرشيفُ يُشير إلى ملفٍّ لا وجودَ له.`);
    } else if (!/<key>aps-environment<\/key>\s*<string>production<\/string>/.test(read(relEnt))) {
        problems.push(`${relEnt} لا يقول aps-environment = production — `
            + 'والتوقيعُ اليدويّ يضمّن الملفَّ حرفياً، فستموت الإشعاراتُ في المتجر بصمت.');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ٣) رقمُ نسخةِ أندرويد مُشتقٌّ ولا يُكتب حرفياً
// ═══════════════════════════════════════════════════════════════════════════
{
    const G = 'android/app/build.gradle';
    const g = stripGroovyComments(read(G));
    // 🔴 وهذا بعينه ما تجمّد: `versionCode 155800` بيدٍ تحت تعليقٍ يَعِد
    //    بسكربتٍ لا وجودَ له، فبقي عشرين إصداراً.
    if (/versionCode\s+\d/.test(g)) {
        problems.push(`${G} يحمل versionCode رقماً مكتوباً — يُشتقّ من sw.js/package.json.`);
    }
    if (/versionName\s+["']/.test(g)) {
        problems.push(`${G} يحمل versionName نصّاً مكتوباً — يُشتقّ من sw.js/package.json.`);
    }
    for (const [needle, why] of [
        ['CACHE_NAME', 'المصدرُ الحيُّ للرقم (sw.js)'],
        ['takiVersionCode', 'الرقمُ المُشتقّ'],
        ['takiVersionName', 'الاسمُ المُشتقّ'],
    ]) {
        if (!g.includes(needle)) problems.push(`${G} لا يذكر «${needle}» — ${why}.`);
    }
    // ٣ب) والمُشتقُّ يُحسب هنا بنفس الصيغة ويُقارن — فلو انحرفت صيغةُ Groovy
    //     يوماً ظهر الانحرافُ هنا لا في أوّل رفعةٍ إلى قوقل.
    const sw = /CACHE_NAME\s*=\s*['"]taki-cache-v(\d+)\.(\d+)['"]/.exec(read('sw.js'));
    const pkg = /"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"/.exec(read('package.json'));
    if (!sw) problems.push('sw.js — تعذّر قراءة CACHE_NAME.');
    else if (!pkg) problems.push('package.json — version ليست بصيغة X.Y.Z.');
    else if (sw[1] !== pkg[1] || sw[2] !== pkg[2]) {
        problems.push(`package.json ${pkg[0]} لا يطابق CACHE_NAME (${sw[1]}.${sw[2]}).`);
    } else {
        const parts = [pkg[1], pkg[2], pkg[3]].map(Number);
        const over = parts.find((n) => n > 99);
        if (over !== undefined) {
            problems.push(`جزءٌ من الإصدار «${over}» أكبرُ من ٩٩ — صيغةُ versionCode تحشو خانتين، `
                + 'فينقص الرقمُ عمّا سبقه. و`versionCode` لا يجوز أن ينقص عند قوقل.');
        } else {
            notes.push(`نسخةُ التطبيقين: ${parts.join('.')} (versionCode ${parts.map((n) => String(n).padStart(2, '0')).join('')})`);
        }
    }
    // ٣ج) و`google-services.json` مُستثنى فعلاً — المستودعُ عامّ.
    const gi = read('android/.gitignore');
    if (!/^google-services\.json\s*$/m.test(gi)) {
        problems.push('android/.gitignore لا يستثني google-services.json (كان السطرُ معلَّقاً) — '
            + 'والمستودعُ عامّ، فملفٌّ يدخله لحظةً يبقى في تاريخه أبداً.');
    }
}

if (problems.length) {
    console.error('\n❌ عقدُ الإصدار مكسور: «أخضر» قد يعني صفرَ ملفّ\n');
    for (const p of problems) console.error('   • ' + p);
    console.error('\n   وهذا ليس تجميلاً: سبعُ جلساتٍ خضراء أنتجت صفرَ حزمةٍ قابلةٍ للرفع.\n');
    process.exit(1);
}
console.log('✅ عقدُ الإصدار: ' + notes.join(' · '));
