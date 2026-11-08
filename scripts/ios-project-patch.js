#!/usr/bin/env node
/**
 * ios-project-patch.js — يسجّل ملفّاتِ المتجر في مشروع Xcode (v15.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لماذا سكربتٌ ولا تحريرٌ يدويّ**: `npx cap add ios` يُعيد توليدَ
 *    المشروع، و`npx cap sync` قد يلمسه. وملفٌّ موجودٌ على القرص لكنه **غيرُ
 *    مسجَّلٍ في `project.pbxproj` لا يدخل الحزمةَ إطلاقاً** — فيُرفع التطبيق
 *    بلا `PrivacyInfo.xcprivacy` فتردّه أبل آلياً، أو بلا الترجمات فيظهر
 *    بالإنجليزية على جهازٍ عربيّ. ولا شيءَ في البناء يصرخ.
 *
 * 🪤 ويُشغَّل **قبل** كلّ بناءِ iOS (في سير GitHub Actions)، وهو **خاملُ
 *    التكرار**: يفحص وجودَ كلّ تسجيلٍ قبل إضافته.
 *
 * ما يسجّله:
 *   ١) `PrivacyInfo.xcprivacy`  → مرحلةُ الموارد (إلزاميٌّ عند أبل منذ ٢٠٢٤)
 *   ٢) `App.entitlements`       → `CODE_SIGN_ENTITLEMENTS` (الإشعاراتُ والروابط)
 *   ٣) `InfoPlist.strings` ar/en → مجموعةُ تنويعٍ + `knownRegions`
 *   ٤) الإصدارُ من `package.json` → `MARKETING_VERSION` و`CURRENT_PROJECT_VERSION`
 *   ٥) `IPHONEOS_DEPLOYMENT_TARGET` و`TARGETED_DEVICE_FAMILY` (جوّال + لوحيّ)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PBX = path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');
if (!fs.existsSync(PBX)) { console.error('❌ مشروعُ iOS غير موجود:', PBX); process.exit(1); }

let s = fs.readFileSync(PBX, 'utf8');
const before = s;
const changes = [];

// معرّفاتٌ ثابتةٌ من مدانا الخاصّ — فإعادةُ التشغيل لا تُنشئ نسخةً ثانية.
const ID = {
    privRef: 'TAKI0001000000000000PRIV', privBuild: 'TAKI0002000000000000PRIV',
    entRef: 'TAKI0003000000000000ENTI',
    strGroup: 'TAKI0004000000000000STRG', strBuild: 'TAKI0005000000000000STRB',
    strAr: 'TAKI0006000000000000STAR', strEn: 'TAKI0007000000000000STEN',
    iapRef: 'TAKI0008000000000000IAPR', iapBuild: 'TAKI0009000000000000IAPB',
};

/** يُدرج نصّاً بعد أوّل مرساة، ويتأكّد أن الإدراج وقع فعلاً. */
function insertAfter(anchor, text, label) {
    const i = s.indexOf(anchor);
    if (i < 0) throw new Error(`المرساةُ غائبة (${label}): ${anchor.slice(0, 60)}`);
    s = s.slice(0, i + anchor.length) + text + s.slice(i + anchor.length);
    changes.push(label);
}

// ── ٠) إضافةُ الشراء داخل التطبيق (TakiIapPlugin.swift) ────────────────────
// 🔴 **ملفُّ Swift غيرُ مسجَّلٍ في مرحلة `Sources` لا يُترجَم إطلاقاً** — ولا
//    يصرخ أيُّ شيء: البناءُ ينجح أخضرَ، والتطبيقُ يعمل، وأوّلُ نداءٍ للإضافة
//    يردّ «غير منفَّذة» لا أكثر. و`cap sync` **لا يسجّل ملفّات هدف التطبيق**
//    (يسجّل الإضافاتَ المحزومة وحدها)، فلا سبيلَ غيرُ هذا السطر.
// 🪤 ويلزم **ثلاثُ مواضع لا موضعان**: مرجعُ الملفّ (PBXFileReference)،
//    وعنصرُ البناء (PBXBuildFile)، **ومرحلةُ Sources**. ونسيانُ الثالث يُنتج
//    ملفّاً ظاهراً في Xcode ولا يُترجَم — وهو أخبثُ الثلاثة.
if (!s.includes('TakiIapPlugin.swift')) {
    insertAfter('/* Begin PBXFileReference section */\n',
        `\t\t${ID.iapRef} /* TakiIapPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = TakiIapPlugin.swift; sourceTree = "<group>"; };\n`,
        'مرجعُ TakiIapPlugin.swift');
    insertAfter('/* Begin PBXBuildFile section */\n',
        `\t\t${ID.iapBuild} /* TakiIapPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ID.iapRef} /* TakiIapPlugin.swift */; };\n`,
        'عنصرُ بناء TakiIapPlugin.swift');
    insertAfter('\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n',
        `\t\t\t\t${ID.iapBuild} /* TakiIapPlugin.swift in Sources */,\n`,
        'TakiIapPlugin.swift في مرحلة Sources');
    insertAfter('\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n',
        `\t\t\t\t${ID.iapRef} /* TakiIapPlugin.swift */,\n`,
        'TakiIapPlugin.swift في مجموعة الملفّات');
}

// ── ١) PrivacyInfo.xcprivacy ───────────────────────────────────────────────
if (!s.includes('PrivacyInfo.xcprivacy')) {
    insertAfter('/* Begin PBXFileReference section */\n',
        `\t\t${ID.privRef} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n`,
        'مرجعُ بيان الخصوصية');
    insertAfter('/* Begin PBXBuildFile section */\n',
        `\t\t${ID.privBuild} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${ID.privRef} /* PrivacyInfo.xcprivacy */; };\n`,
        'ملفُّ بناء الخصوصية');
    insertAfter('\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n',
        `\t\t\t\t${ID.privBuild} /* PrivacyInfo.xcprivacy in Resources */,\n`,
        'بيانُ الخصوصية في الموارد');
    insertAfter('\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n',
        `\t\t\t\t${ID.privRef} /* PrivacyInfo.xcprivacy */,\n`,
        'بيانُ الخصوصية في المجموعة');
}

// ── ٢) App.entitlements ────────────────────────────────────────────────────
if (!s.includes('App.entitlements')) {
    insertAfter('/* Begin PBXFileReference section */\n',
        `\t\t${ID.entRef} /* App.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = App.entitlements; sourceTree = "<group>"; };\n`,
        'مرجعُ الصلاحيات');
    insertAfter('\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n',
        `\t\t\t\t${ID.entRef} /* App.entitlements */,\n`,
        'الصلاحياتُ في المجموعة');
    s = s.replace(/(\n\t{4}INFOPLIST_FILE = App\/Info\.plist;)/g,
        '\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1');
    changes.push('إعدادُ CODE_SIGN_ENTITLEMENTS');
}

// ── ٣) ترجماتُ Info.plist (مجموعةُ تنويع) ──────────────────────────────────
if (!s.includes('InfoPlist.strings')) {
    insertAfter('/* Begin PBXFileReference section */\n',
        `\t\t${ID.strAr} /* ar */ = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = ar; path = ar.lproj/InfoPlist.strings; sourceTree = "<group>"; };\n` +
        `\t\t${ID.strEn} /* en */ = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = en; path = en.lproj/InfoPlist.strings; sourceTree = "<group>"; };\n`,
        'مراجعُ الترجمات');
    insertAfter('/* Begin PBXVariantGroup section */\n',
        `\t\t${ID.strGroup} /* InfoPlist.strings */ = {\n\t\t\tisa = PBXVariantGroup;\n\t\t\tchildren = (\n` +
        `\t\t\t\t${ID.strAr} /* ar */,\n\t\t\t\t${ID.strEn} /* en */,\n` +
        `\t\t\t);\n\t\t\tname = InfoPlist.strings;\n\t\t\tsourceTree = "<group>";\n\t\t};\n`,
        'مجموعةُ تنويع الترجمات');
    insertAfter('/* Begin PBXBuildFile section */\n',
        `\t\t${ID.strBuild} /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; fileRef = ${ID.strGroup} /* InfoPlist.strings */; };\n`,
        'ملفُّ بناء الترجمات');
    insertAfter('\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n',
        `\t\t\t\t${ID.strBuild} /* InfoPlist.strings in Resources */,\n`,
        'الترجماتُ في الموارد');
    insertAfter('\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n',
        `\t\t\t\t${ID.strGroup} /* InfoPlist.strings */,\n`,
        'الترجماتُ في المجموعة');
}

// `knownRegions` بلا `ar` يعني أن Xcode يتجاهل مجلّدَ ar.lproj تماماً.
if (!/knownRegions = \([^)]*\bar\b/s.test(s)) {
    s = s.replace('knownRegions = (\n\t\t\t\ten,', 'knownRegions = (\n\t\t\t\tar,\n\t\t\t\ten,');
    changes.push('إضافةُ ar إلى knownRegions');
}
// ومنطقةُ التطوير عربيّةٌ لأن السوقَ سعوديّ.
if (s.includes('developmentRegion = en;')) {
    s = s.replace('developmentRegion = en;', 'developmentRegion = ar;');
    changes.push('منطقةُ التطوير ⇐ ar');
}

// ── ٤) الإصدارُ من package.json ────────────────────────────────────────────
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const build = ver.split('.').slice(0, 3).map(n => String(parseInt(n, 10)).padStart(2, '0')).join('');
// 🪤 `CFBundleVersion` **لا يجوز أن ينقص** عند أبل — فيُشتقّ من نفس المصدر
//    الذي يشتقّ منه أندرويد، فلا ينحرف الرقمان.
s = s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${ver};`);
s = s.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
changes.push(`الإصدار ⇐ ${ver} (${build})`);

// ── ٥) الحدُّ الأدنى للنظام ────────────────────────────────────────────────
// 🔴 **١٥٫٠ لا ١٤٫٠** — ودرسٌ كلّف بناءً كاملاً: ضبطتُها ١٤ فسقط البناءُ على
//    منصّة GitHub بتسعة أخطاءٍ من صيغةٍ واحدة:
//      "The package product 'CapacitorApp' requires minimum platform version
//       15.0 for the iOS platform, but this target supports 14.0"
//    أي أن إضافاتِ Capacitor 8 تشترط ١٥ بينما قالبُ `Package.swift` يقول ١٤.
// 🪤 ويلزم تغييرُ **الاثنين معاً**: إعدادُ المشروع و`Package.swift`. وتغييرُ
//    أحدهما وحدَه يُبقي نفسَ الخطأ حرفياً — فيبدو الإصلاحُ وكأنه لم يقع.
// 🪤 وiOS 15 لا يُقصي أحداً عملياً (صدر ٢٠٢١)، وأبل تشترط استهدافَ ١٣ فأعلى.
const IOS_MIN = '15.0';
if (!new RegExp(`IPHONEOS_DEPLOYMENT_TARGET = ${IOS_MIN};`).test(s)) {
    s = s.replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_MIN};`);
    changes.push(`هدفُ النشر ⇐ iOS ${IOS_MIN}`);
}

// و`Package.swift` الذي يولّده Capacitor (ويقول عن نفسه «لا تعدّله») —
// يُعدَّل هنا بعد كلّ مزامنةٍ لأنها تُعيد كتابتَه بـ.v14.
{
    const pkg = path.join(ROOT, 'ios/App/CapApp-SPM/Package.swift');
    if (fs.existsSync(pkg)) {
        const before = fs.readFileSync(pkg, 'utf8');
        const after = before.replace(/platforms:\s*\[\s*\.iOS\(\.v\d+\)\s*\]/,
                                     'platforms: [.iOS(.v15)]');
        if (after !== before) { fs.writeFileSync(pkg, after); changes.push('Package.swift ⇐ .iOS(.v15)'); }
        if (!/\.iOS\(\.v15\)/.test(fs.readFileSync(pkg, 'utf8'))) {
            console.error('❌ Package.swift ما زال دون .v15 — إضافاتُ Capacitor تشترطها.');
            process.exit(1);
        }
    }
}

// 🔴 **ولا خروجَ قبل التحقّق.** كان هنا:
//      if (s === before) { console.log('…مسجَّلٌ سلفاً'); process.exit(0); }
//    قبل كتلة العقود السبعة — أي أن المشروعَ لو وُجد مطابقاً **خرج أخضرَ
//    بلا فحصِ** أن `PrivacyInfo` والصلاحيّاتَ والترجماتِ وiOS 15 و
//    `TakiIapPlugin.swift` مسجَّلةٌ فعلاً. وهي بعينها الرفضياتُ الصامتةُ
//    التي كُتب هذا السكربتُ لمنعها. وكان العيبُ **مُقنَّعاً** لأن السطرَين
//    ١٣٩–١٤٠ يُعيدان كتابةَ رقم الإصدار في كلّ تشغيلٍ فيكون `s !== before`
//    غالباً — أي حارسٌ يعمل بالحظّ.
const changed = s !== before;
if (changed) fs.writeFileSync(PBX, s);

// ── التحقّق: كلُّ عقدٍ يُفحص في الناتج، لا في النيّة ────────────────────────
const out = fs.readFileSync(PBX, 'utf8');
const must = [
    ['CODE_SIGN_ENTITLEMENTS = App/App.entitlements;', 'الصلاحيات'],
    [`MARKETING_VERSION = ${ver};`, 'الإصدارُ التسويقيّ'],
    ['isa = PBXVariantGroup', 'مجموعةُ التنويع'],
    ['IPHONEOS_DEPLOYMENT_TARGET = 15.0;', 'الحدُّ الأدنى iOS 15'],
];
let bad = 0;
for (const [needle, label] of must) {
    if (!out.includes(needle)) { console.error(`❌ ${label} لم يُسجَّل`); bad = 1; }
}

// 🔴 **والعضويّةُ في المرحلة تُقاس داخل المرحلة، لا في الملفّ كلِّه.** جُرِّب
//    هذا مكسوراً فمرّ كاذباً: حُذف سطرُ `PrivacyInfo.xcprivacy in Resources`
//    من **مرحلة الموارد** فبقي السطرُ التصريحيُّ (`PBXBuildFile`) يحمل نفسَ
//    التعليق حرفياً، فوجدَه `includes` وأُعلن النجاح — والحزمةُ تُبنى بلا
//    بيانِ خصوصيةٍ فتردّها أبل آلياً. وهو نفسُ فخّ «التصريحُ ليس النداء»
//    الذي دُفع ثمنُه في `finalizePurchase`.
const inPhase = (phaseIsa, endMark, needle) => {
    const i = out.indexOf(`isa = ${phaseIsa}`);
    const j = out.indexOf(endMark);
    return i >= 0 && j > i && out.slice(i, j).includes(needle);
};
for (const [phase, endMark, needle, label] of [
    ['PBXResourcesBuildPhase', '/* End PBXResourcesBuildPhase section */',
     'PrivacyInfo.xcprivacy in Resources', 'بيانُ الخصوصية في مرحلة الموارد'],
    ['PBXResourcesBuildPhase', '/* End PBXResourcesBuildPhase section */',
     'InfoPlist.strings in Resources', 'الترجماتُ في مرحلة الموارد'],
    ['PBXSourcesBuildPhase', '/* End PBXSourcesBuildPhase section */',
     'TakiIapPlugin.swift in Sources', 'إضافةُ الشراء في مرحلة Sources'],
]) {
    if (!inPhase(phase, endMark, needle)) {
        console.error(`❌ ${label} — موجودٌ كتصريحٍ وغيرُ مُدرَجٍ في المرحلة نفسِها، أو غائبٌ تماماً.`);
        bad = 1;
    }
}
if (!/knownRegions = \([^)]*\bar\b/s.test(out)) { console.error('❌ ar غائبةٌ عن knownRegions'); bad = 1; }
// وملفُّ صلاحيّات الإصدار موجود: الأرشفةُ تُمرّره في سطر الأمر، فملفٌّ
// غائبٌ يُفشل الأرشيفَ بعد عشرين دقيقةً بدل أن يُكشف هنا في ثانية.
if (!fs.existsSync(path.join(ROOT, 'ios/App/App/App.Release.entitlements'))) {
    console.error('❌ App.Release.entitlements غائب — وهو ما يُوقَّع به أرشيفُ المتجر '
        + '(aps-environment = production). التوقيعُ اليدويّ يضمّن الملفَّ حرفياً.');
    bad = 1;
}
if (bad) process.exit(1);

if (!changed) { console.log('ℹ️ مشروعُ Xcode مسجَّلٌ سلفاً — والعقودُ السبعةُ مفحوصةٌ كلُّها.'); process.exit(0); }
console.log('✅ مشروعُ Xcode:', changes.join(' · '));
