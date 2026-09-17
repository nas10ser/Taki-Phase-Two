// اختبار ضوابط بوّابة الخرائط (v14.54) — SSRF وقائمة النطاقات.
// التشغيل:  node scripts/test-map-ssrf.js
// المعيار: العنوان الذي **يُجلب** عنوانُ خرائط عام. وكل ما عداه يُرفض باسم
// السبب — قبل أي طلب شبكة، وعلى **كل قفزة** لا على الأولى وحدها.
const { _internals: I } = require('../api/resolve-map.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '  ← ' + extra}`);
    cond ? pass++ : fail++;
};

/** يُرجع اسم سبب الرفض، أو 'ALLOWED' إن مرّ. */
const verdict = (u) => { try { I.assertAllowed(u); return 'ALLOWED'; } catch (e) { return e.message; } };

// ── يجب أن تمرّ: عناوين خرائط جوجل الحقيقية ────────────────────────────────
for (const u of [
    'https://maps.app.goo.gl/AbC123',
    'https://goo.gl/maps/xyz',
    'https://maps.google.com/?q=24.7136,46.6753',
    'https://www.google.com/maps/place/@24.7,46.6,15z',
    'https://maps.google.com.sa/?q=1,2',
]) ok(`يمرّ: ${u.slice(0, 46)}`, verdict(u) === 'ALLOWED', verdict(u));

// ── يجب أن تُرفض: نطاقات خارجية ────────────────────────────────────────────
for (const u of [
    'https://example.com/',
    'https://evil.com/maps.google.com',
    'https://maps.google.com.evil.com/',   // لاحقةٌ مخادعة
    'https://evil-google.com/',            // بلا نقطة قبل النطاق
    'https://notgoogle.com/',
    'https://googlecom/',
]) ok(`يُرفض نطاق خارجي: ${u.slice(0, 40)}`, verdict(u) === 'HOST_NOT_ALLOWED', verdict(u));

// ── يجب أن تُرفض: عناوين داخلية (SSRF) ─────────────────────────────────────
// 🪤 الفحص القديم كان تعابير نمطية على النصّ (`/^https?:\/\/127\./`) — ويمرّ
// منها `127.1` و`2130706433` و`0x7f000001`، وكلها المضيف المحلّي نفسه.
for (const u of [
    'http://169.254.169.254/latest/meta-data/',   // بيانات وصف السحابة
    'http://127.0.0.1/',
    'http://127.1/',
    'http://localhost/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://db.internal/',
]) ok(`يُرفض عنوان داخلي: ${u.slice(0, 40)}`, verdict(u) === 'PRIVATE_HOST', verdict(u));

// ── يجب أن تُرفض: بروتوكولات وصيغ غير صالحة ────────────────────────────────
ok('يُرفض file://', verdict('file:///etc/passwd') === 'BAD_SCHEME', verdict('file:///etc/passwd'));
ok('يُرفض javascript:', ['BAD_SCHEME', 'BAD_URL'].includes(verdict('javascript:alert(1)')), verdict('javascript:alert(1)'));
ok('يُرفض gopher://', verdict('gopher://x/') === 'BAD_SCHEME', verdict('gopher://x/'));
ok('يُرفض نصّ ليس عنواناً', verdict('ليس عنواناً') === 'BAD_URL', verdict('ليس عنواناً'));
ok('يُرفض الفراغ', verdict('') === 'BAD_URL', verdict(''));

// ── الفحص هو الفحص نفسه على كل قفزة ────────────────────────────────────────
// 🪤 الثقب القديم: العنوان الأوّل يُفحص، ثم `Location` يُتبع بلا فحص. فمحاكاةُ
// سلسلة تحويلٍ تنتهي إلى عنوان داخلي يجب أن تقف عند القفزة المخالفة.
const chain = ['https://maps.app.goo.gl/a', 'https://maps.google.com/?q=1,2', 'http://169.254.169.254/'];
let stoppedAt = -1;
chain.forEach((u, i) => { if (stoppedAt < 0 && verdict(u) !== 'ALLOWED') stoppedAt = i; });
ok('سلسلة تحويل تنتهي داخلياً ⇒ تقف عند القفزة الثالثة', stoppedAt === 2, `وقفت عند ${stoppedAt}`);

// ── استخراج الإحداثيات ما زال يعمل (لم تكسره التحصينات) ────────────────────
const c = I.tryExtract('https://maps.google.com/?q=24.7136,46.6753');
ok('يستخرج إحداثيات الرياض', !!c && Math.round(c.lat) === 25 && Math.round(c.lng) === 47, JSON.stringify(c));
ok('يرفض إحداثيات خارج السعودية', I.tryExtract('https://maps.google.com/?q=48.8566,2.3522') === null);

console.log(`\nنتيجة: ${pass} ناجح · ${fail} فاشل`);
process.exit(fail ? 1 : 0);
