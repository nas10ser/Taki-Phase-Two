#!/usr/bin/env node
/**
 * check-store-listing.js — نصوصُ المتجرين لا تتجاوز حدودَها.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الفخُّ الذي وُلد منه هذا الفحص: حقلُ الكلمات المفتاحيّة عند أبل محدودٌ
 *    بـ**١٠٠ بايت لا ١٠٠ حرف**، و**الحرفُ العربيُّ بايتان** في UTF-8. فنصٌّ
 *    من ٧٠ حرفاً عربياً يبدو داخلَ الحدّ وهو ١٤٠ بايتاً — ويُرفض. والعدُّ
 *    بالعين يكذب هنا بالضبط.
 *
 * ولماذا يُفشل البناء: نصٌّ متجاوزٌ لا يُكتشف إلّا حين تُرفض النشرةُ بعد
 * رفعٍ وانتظار. وهذا أرخصُ موضعٍ لاكتشافه.
 *
 * يقرأ `store/LISTING.md` ويقيس كلَّ كتلةِ كودٍ تحت عنوانٍ يحمل حدَّه.
 */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'store', 'LISTING.md');
if (!fs.existsSync(P)) { console.error('❌ store/LISTING.md غير موجود'); process.exit(1); }
const src = fs.readFileSync(P, 'utf8');

// الحدودُ الرسميّة (قُرئت ١٣ نوفمبر ٢٠٢٦ من صفحتَي المزوّدين)
const LIMITS = [
    { re: /`App Name`[^\n]*٣٠/,            max: 30,   unit: 'chars', label: 'أبل · الاسم' },
    { re: /`Subtitle`[^\n]*٣٠/,            max: 30,   unit: 'chars', label: 'أبل · العنوان الفرعيّ' },
    { re: /`Keywords`[^\n]*١٠٠ بايت/,      max: 100,  unit: 'bytes', label: 'أبل · الكلمات (عربي)' },
    { re: /`Promotional Text`[^\n]*١٧٠/,   max: 170,  unit: 'chars', label: 'أبل · الترويجيّ' },
    { re: /`Description`[^\n]*٤٠٠٠/,       max: 4000, unit: 'chars', label: 'أبل · الوصف' },
    { re: /\*\*App Name\*\* · 30 max/,     max: 30,   unit: 'chars', label: 'Apple · Name' },
    { re: /\*\*Subtitle\*\* · 30 max/,     max: 30,   unit: 'chars', label: 'Apple · Subtitle' },
    { re: /\*\*Keywords\*\* · 100 bytes/,  max: 100,  unit: 'bytes', label: 'Apple · Keywords' },
    { re: /\*\*Promotional Text\*\* · 170 max/, max: 170, unit: 'chars', label: 'Apple · Promo' },
    { re: /\*\*Description\*\* · 4000 max/, max: 4000, unit: 'chars', label: 'Apple · Description' },
    { re: /`App name`[^\n]*٣٠/,            max: 30,   unit: 'chars', label: 'قوقل · العنوان' },
    { re: /`Short description`[^\n]*٨٠/,   max: 80,   unit: 'chars', label: 'قوقل · المختصر' },
    { re: /`Full description`[^\n]*٤٠٠٠/,  max: 4000, unit: 'chars', label: 'قوقل · الكامل' },
    { re: /\*\*App name\*\* · 30 max/,     max: 30,   unit: 'chars', label: 'Google · Name' },
    { re: /\*\*Short description\*\* · 80 max/, max: 80, unit: 'chars', label: 'Google · Short' },
    { re: /\*\*Full description\*\* · 4000 max/, max: 4000, unit: 'chars', label: 'Google · Full' },
];

/** أوّلُ كتلةِ كودٍ بعد موضعٍ معيّن. */
const blockAfter = (from) => {
    const open = src.indexOf('```', from);
    if (open < 0) return null;
    const nl = src.indexOf('\n', open);
    const close = src.indexOf('```', nl);
    if (close < 0) return null;
    return src.slice(nl + 1, close).replace(/\n$/, '');
};

let bad = 0, n = 0;
for (const L of LIMITS) {
    const m = L.re.exec(src);
    if (!m) { console.error(`❌ لم أجد حقلَ «${L.label}» في LISTING.md`); bad++; continue; }
    const body = blockAfter(m.index + m[0].length);
    if (body === null) { console.error(`❌ لا كتلةَ نصٍّ بعد «${L.label}»`); bad++; continue; }
    const size = L.unit === 'bytes' ? Buffer.byteLength(body, 'utf8') : [...body].length;
    n++;
    const pct = Math.round((size / L.max) * 100);
    if (size > L.max) {
        console.error(`❌ ${L.label}: ${size} ${L.unit} — تجاوز الحدَّ (${L.max})`);
        bad++;
    } else {
        console.log(`   ✅ ${String(size).padStart(4)}/${L.max} ${L.unit.padEnd(5)} (${String(pct).padStart(3)}%)  ${L.label}`);
    }
}

if (bad) { console.error(`\n❌ ${bad} حقلاً يُرفض — صحّحه قبل اللصق في المتجر.`); process.exit(1); }
console.log(`\n✅ نصوصُ المتجرين: ${n} حقلاً كلُّها داخل حدودها`);
