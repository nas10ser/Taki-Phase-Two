#!/usr/bin/env node
/**
 * set-assetlinks.js — يكتب `.well-known/assetlinks.json` من بصمةٍ واحدة.
 * ═══════════════════════════════════════════════════════════════════════════
 * التشغيل:  node scripts/set-assetlinks.js AB:CD:…:EF
 *
 * 🔴 البصمةُ المطلوبة هي بصمةُ **مفتاح توقيع التطبيق** (App signing key) من
 *    Play Console ← Setup ← App integrity — **لا** بصمةُ مفتاح الرفع (Upload
 *    key). وهذا أشهرُ خطأٍ في نشر TWA: يبني المطوّر بمفتاح الرفع فيضع بصمته،
 *    وقوقل تُعيد توقيع الحزمة بمفتاحها هي، فتفشل المطابقةُ **بصمت** ويظهر
 *    التطبيق وفيه **شريطُ عنوان متصفّح** أعلى الشاشة. ولا رسالةَ خطأٍ أبداً.
 *    🪤 ولو كان مفتاحُ الرفع هو نفسه مفتاحَ التوقيع (حين لا تُستعمل خدمةُ
 *       توقيع قوقل) فالبصمتان واحدة — والقاعدةُ تبقى: خُذها من App integrity.
 *
 * 🪤 ولماذا سكربتٌ ولا يُكتب الملفُّ يدوياً: النشرُ **ببصمةٍ خاطئة أسوأُ من
 *    غياب الملفّ** — الغيابُ يُفشل التحقّق صراحةً في `adb`، والخطأُ يُنتج
 *    تطبيقاً يبدو عاملاً وهو يعرض شريطَ عنوان لكلّ من ينزّله. فالصيغةُ تُفحص
 *    هنا (٦٤ محرفاً ستّ عشرية في ٣٢ ثُمانيّة)، ويُرفض القالبُ غيرَ المعبَّأ.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'store', 'assetlinks.template.json');
const OUT_DIR = path.join(ROOT, '.well-known');
const OUT = path.join(OUT_DIR, 'assetlinks.json');

const raw = (process.argv[2] || '').trim().toUpperCase();
if (!raw) {
    console.error('الاستعمال: node scripts/set-assetlinks.js <SHA-256 من Play Console ← Setup ← App integrity>');
    console.error('مثال:      node scripts/set-assetlinks.js A1:B2:C3:…:FF');
    process.exit(1);
}

// الصيغةُ المقبولة: ٣٢ ثُمانيّة ستّ عشرية مفصولةٌ بنقطتين (أو بلا فواصل).
const hex = raw.replace(/:/g, '');
if (!/^[0-9A-F]{64}$/.test(hex)) {
    console.error(`❌ البصمةُ غير صالحة: ${hex.length} محرفاً ستّ عشرياً، والمطلوب ٦٤.`);
    console.error('   تُنسخ كما هي من Play Console (SHA-256 certificate fingerprint).');
    process.exit(1);
}
const fingerprint = hex.match(/.{2}/g).join(':');

const tpl = fs.readFileSync(TPL, 'utf8');
if (!tpl.includes('__SHA256_FINGERPRINT__')) {
    console.error('❌ القالبُ لا يحمل المَوضعَ `__SHA256_FINGERPRINT__` — لا تُخمَّن بنيتُه.');
    process.exit(1);
}
const out = tpl.replace('__SHA256_FINGERPRINT__', fingerprint);

// تحقّقٌ من أن الناتجَ JSON صالحٌ وبالبنية التي يقرؤها أندرويد فعلاً.
let parsed;
try { parsed = JSON.parse(out); } catch (e) {
    console.error('❌ الناتجُ ليس JSON صالحاً:', e.message); process.exit(1);
}
const ok = Array.isArray(parsed) && parsed.length === 1
    && Array.isArray(parsed[0].relation)
    && parsed[0].relation.includes('delegate_permission/common.handle_all_urls')
    && parsed[0].target?.namespace === 'android_app'
    && typeof parsed[0].target?.package_name === 'string'
    && parsed[0].target.sha256_cert_fingerprints?.[0] === fingerprint;
if (!ok) { console.error('❌ بنيةُ الناتج لا تطابق ما يقرؤه أندرويد.'); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`✅ كُتب .well-known/assetlinks.json للحزمة ${parsed[0].target.package_name}`);
console.log(`   البصمة: ${fingerprint.slice(0, 11)}…${fingerprint.slice(-11)}`);
console.log('   ثمّ: npm run build && git push — و`copy-static` ينسخه إلى dist.');
console.log('   التحقّقُ بعد النشر:');
console.log('     curl -s https://www.takisa.net/.well-known/assetlinks.json');
