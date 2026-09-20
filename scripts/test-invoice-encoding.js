/**
 * اختبار ترميز الفاتورة — يمنع عودة النسخة الثانية (v14.68)
 * ═══════════════════════════════════════════════════════════════════════════
 * من تدقيق ٩ سبتمبر ٢٠٢٦: «منطق الفاتورة والباركود مكتوب مرّتين (موقع + بوت):
 * خطرٌ حقيقي لو صُحّح أحدهما وحده». وكان الخطر واقعاً لا محتملاً: نسختا ترميز
 * زاتكا اختلفتا فعلاً لاسم بائعٍ أطول من ٢٥٥ بايتاً.
 *
 * هذا الملف يثبّت ثلاثة أشياء، ويُشغَّل داخل `npm test` فيُفشل البناء:
 *  ١) متّجهات ذهبية لـCode 128B — أي تعديلٍ في الجدول أو في مجموع التحقّق يظهر.
 *  ٢) متّجهات ذهبية لرمز زاتكا — **نفسها حرفاً بحرف** مثبّتة داخل هجرة
 *     `v14_68d` على القاعدة، فلو انحرف أحد الطرفين ظهر الانحراف هنا أو هناك.
 *  ٣) حارسٌ بنيويّ: لا نسخة ثانية من جدول الأنماط ولا من مُرمِّز TLV في
 *     المستودع خارج `shared/`.
 *
 * 🪤 و«الاختبار الذي لا يفشل أسوأ من لا اختبار»: كل حارسٍ هنا يُجرَّب سالباً
 *    على نصٍّ مفبرك قبل أن يُصدَّق على المستودع.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { encode128B } = require(path.join(ROOT, 'shared/code128.js'));
const { zatcaTlvBase64 } = require(path.join(ROOT, 'shared/zatcaTlv.js'));

let failures = 0;
const ok = (name) => console.log(`  ✅ ${name}`);
const bad = (name, got, want) => {
    failures++;
    console.error(`  ❌ ${name}\n     خرج : ${String(got).slice(0, 90)}\n     المنتظَر: ${String(want).slice(0, 90)}`);
};
const eq = (name, got, want) => (String(got) === String(want) ? ok(name) : bad(name, got, want));

// ── ١) Code 128B ───────────────────────────────────────────────────────────
console.log('\n■ باركود Code 128B (متّجهات ذهبية)');
// المتّجهات مأخوذة من المُرمِّز الموحَّد بعد إثبات تطابقه مع النسختين القديمتين
// (٩ عيّنات، ٩ تطابقات). و«A» مفكوكةٌ يدوياً للتأكّد: البداية B (١٠٤) = ٢١١٢١٤،
// و«A» (٦٥−٣٢=٣٣) = ١١١٣٢٣، ومجموع التحقّق (١٠٤+٣٣) mod ١٠٣ = ٣٤ = ١٣١١٢٣،
// والإيقاف = ٢٣٣١١١٢.
eq('SKU-1001',
   encode128B('SKU-1001'),
   '2112142131131123312131311221321232211231221231221232213121132331112');
eq('TAKI-2026',
   encode128B('TAKI-2026'),
   '2112142133111113231123312313111221322232111231222232112231122212132331112');
eq('A (محرف واحد، مفكوكة يدوياً)', encode128B('A'), '2112141113231311232331112');
eq('عربيّ كامل ⇐ لا باركود', encode128B('عربي'), 'null');
eq('مسافات ⇐ لا باركود',     encode128B('   '),  'null');
eq('فراغ ⇐ لا باركود',       encode128B(null),   'null');
// 🪤 نسخة الموقع القديمة كانت تطبع الكلمة «null» باركوداً حين يصلها فراغ.

// ── ٢) رمز زاتكا (TLV ثم Base64) ───────────────────────────────────────────
console.log('\n■ رمز زاتكا (نفس متّجهات هجرة v14_68d على القاعدة)');
const SHORT = zatcaTlvBase64('متجر تاكي للعطور', '310000000000003',
                             '2026-09-20T10:15:00.000Z', '115.00', '15.00');
eq('المتّجه القصير', SHORT,
   'AR7Zhdiq2KzYsSDYqtin2YPZiiDZhNmE2LnYt9mI2LECDzMxMDAwMDAwMDAwMDAwMwMYMjAyNi0wOS0yMFQxMDoxNTowMC4wMDBaBAYxMTUuMDAFBTE1LjAw');
eq('لا سطر جديد في الرمز', /[\r\n]/.test(SHORT), 'false');
// 🪤 `encode(bytea,'base64')` في PostgreSQL يلفّ كل ٧٦ محرفاً — وهو العيب الذي
//    ظهر في v14.68 وأُصلح في v14.68d. الطول يكشفه فوراً.
eq('طول المتّجه القصير', SHORT.length, 120);

const LONG = zatcaTlvBase64('متجر '.repeat(60), '310000000000003',
                            '2026-09-20T10:15:00.000Z', '115.00', '15.00');
const md5 = (s) => require('crypto').createHash('md5').update(s).digest('hex');
eq('بصمة المتّجه الطويل (>٢٥٥ بايت)', md5(LONG), '2b1f585b8ac59f9d4f20605e1f2df628');
// بايت الطول ٢٥٤ لا ٢٥٥: القصّ على حدّ محرفٍ عربيّ (بايتان) لا في منتصفه.
eq('بايت طول الاسم المقصوص', Buffer.from(LONG, 'base64')[1], 254);
eq('اسمٌ مقصوصٌ يُقرأ UTF-8 سليماً',
   Buffer.from(LONG, 'base64').subarray(2, 2 + 254).toString('utf8').endsWith('م'), 'true');

// ── ٣) حارس «لا نسخة ثانية» ────────────────────────────────────────────────
console.log('\n■ حارس النسخة الثانية');
const SCAN_DIRS = ['src', 'server', 'scripts'];
const SKIP = new Set(['node_modules', 'dist', '.parcel-cache', '.git']);
const files = [];
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(f);
    }
};
SCAN_DIRS.forEach(d => walk(path.join(ROOT, d)));

/** يُرجع أسماء الملفات المخالفة — يُستعمل على المستودع وعلى نصٍّ مفبرك معاً. */
const findCopies = (entries) => ({
    code128: entries.filter(([, t]) => /'212222'|"212222"/.test(t)).map(([f]) => f),
    tlv: entries.filter(([, t]) => /parts\.push\(\s*i \+ 1|set_byte\(.\\x00|\[seller, vat, iso, total, vatAmt\]/.test(t)).map(([f]) => f),
});

// هذا الملف وحده مُستثنى: هو يحمل **أنماط الحارس** نصّاً، لا نسخةً من المُرمِّز.
const SELF = path.relative(ROOT, __filename);
const entries = files.map(f => [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')])
                     .filter(([f]) => f !== SELF);
const found = findCopies(entries);
// هذا الملف نفسه يذكر «212222»؟ لا — المتّجهات هنا نواتج لا جداول.
eq('لا جدول أنماط ثانٍ خارج shared/', found.code128.join(',') || '—', '—');
eq('لا مُرمِّز TLV ثانٍ خارج shared/', found.tlv.join(',') || '—', '—');

// الاختبار السالب: الحارس يجب أن يرى نسخةً مفبركة، وإلا فهو حارسٌ لا يحرس.
const fake = findCopies([
    ['وهمي/code.ts', "const P = ['212222','222122'];"],
    ['وهمي/tlv.js', "[seller, vat, iso, total, vatAmt].forEach(() => {});"],
]);
eq('الحارس يكشف جدولاً مفبركاً', fake.code128.join(','), 'وهمي/code.ts');
eq('الحارس يكشف مُرمِّزاً مفبركاً', fake.tlv.join(','), 'وهمي/tlv.js');

console.log(failures === 0
    ? '\n✅ ترميز الفاتورة: كل المتّجهات والحرّاس نجحوا\n'
    : `\n❌ ترميز الفاتورة: ${failures} فشل\n`);
process.exit(failures === 0 ? 0 : 1);
