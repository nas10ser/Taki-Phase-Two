#!/usr/bin/env node
/**
 * set-apple-appsite.js — يكتب `.well-known/apple-app-site-association`.
 * ═══════════════════════════════════════════════════════════════════════════
 * التشغيل:  node scripts/set-apple-appsite.js ABCDE12345
 *           (معرّفُ الفريق من developer.apple.com ← Membership)
 *
 * 🔴 ثلاثةُ فخاخٍ تُسقط الروابطَ العميقة **بصمت** عند أبل، وكلُّها محروسةٌ هنا:
 *    ١) **الملفُّ بلا امتداد** — `apple-app-site-association` لا `.json`.
 *       بالامتداد لا يقرؤه النظامُ إطلاقاً.
 *    ٢) **نوعُ المحتوى `application/json`** — أبل تتجاهل ما عداه.
 *    ٣) **بلا أيّ تحويل** — نظامُ أبل لا يتبع ٣٠١/٣٠٢ لهذا الملفّ.
 *    وفي الحالات الثلاث: يُفتح الرابطُ في سفاري ولا يصل التطبيقَ، بلا رسالة.
 *
 * 🪤 ومعرّفُ الفريق عشرةُ محارفَ أبجديةٍ رقميّة كبيرة. وأيُّ خطأٍ فيه يُنتج
 *    ملفّاً صالحَ الصيغة وعديمَ الأثر — فيُفحص هنا.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const team = (process.argv[2] || '').trim().toUpperCase();
if (!/^[A-Z0-9]{10}$/.test(team)) {
    console.error('الاستعمال: node scripts/set-apple-appsite.js <معرّف الفريق — ١٠ محارف>');
    console.error(`❌ «${team || '(فارغ)'}» ليس معرّفَ فريقٍ صالحاً (${team.length} محرفاً، والمطلوب ١٠).`);
    console.error('   يُقرأ من developer.apple.com ← Account ← Membership details ← Team ID.');
    process.exit(1);
}

const tpl = fs.readFileSync(path.join(ROOT, 'store', 'apple-app-site-association.template.json'), 'utf8');
if (!tpl.includes('__APPLE_TEAM_ID__')) { console.error('❌ القالبُ بلا موضعِ المعرّف.'); process.exit(1); }
const out = tpl.replace(/__APPLE_TEAM_ID__/g, team);

let parsed;
try { parsed = JSON.parse(out); } catch (e) { console.error('❌ الناتجُ ليس JSON:', e.message); process.exit(1); }
const ids = parsed?.applinks?.details?.[0]?.appIDs || [];
if (ids.length !== 1 || !ids[0].startsWith(team + '.')) { console.error('❌ بنيةُ الناتج خاطئة.'); process.exit(1); }

const dir = path.join(ROOT, '.well-known');
fs.mkdirSync(dir, { recursive: true });
// 🪤 بلا امتداد عمداً — انظر الفخّ (١) أعلاه.
fs.writeFileSync(path.join(dir, 'apple-app-site-association'), JSON.stringify(parsed, null, 2));
console.log(`✅ كُتب .well-known/apple-app-site-association للفريق ${team}`);
console.log('   ثمّ: npm run build && git push');
// 🪤 و`curl -sI` يفحص **الترويسة** وحدها — والعيبُ المقيس كان ترويسةً
//    سليمةً على جسمِ HTML (٢٠٠ · application/json · والجسمُ index.html).
//    فالترويسةُ كانت التمويه. يُفحص **الجسمُ** إذن، و`-f` تُفشله على ٤٠٤.
console.log('   التحقّقُ بعد النشر (يفحص الجسمَ لا الترويسة — فالترويسةُ كانت تكذب):');
console.log("     curl -fsS https://www.takisa.net/.well-known/apple-app-site-association \\");
console.log("       | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\"سليم:\", d[\"applinks\"][\"details\"][0][\"appIDs\"])'");
