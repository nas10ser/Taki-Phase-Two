#!/usr/bin/env node
/**
 * build-favicon.js — يبني `favicon.ico` من شعار العلامة (v16.32)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 السببُ مقيس (لقطةُ ناصر، ١٣ نوفمبر): شاشةُ «Add Bookmark» في سفاري
 *    عرضت المربّعَ الأخضر القديم بحرف T، وكلُّ أيقوناتنا الحيّة عنابيّة
 *    (`apple-touch-icon` و`logo192` كلاهما `#9e2b4e` — قِيس بالبكسل).
 *    والسبب: **`/favicon.ico` يردّ ٤٠٤**. وسفاري يطلبه تلقائياً قبل أن يَعتدّ
 *    بوسم `<link rel=icon>` المبصوم، فيرتدّ إلى ما في مخزونه القديم.
 *
 * 🪤 وصيغةُ ICO هنا **حاويةُ PNG** لا بكسلاتٍ خاماً: كلُّ متصفّحٍ حديث
 *    (سفاري وكروم وفايرفوكس) يقرأ PNG داخل ICO منذ سنين، والحجمُ عُشرُ الخام.
 * 🪤 ويُولَّد من `logo192.png` نفسِها التي يبنيها `build-logo.js` — فلا أصلَ
 *    ثانٍ ينحرف لونُه عن البقيّة.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'logo192.png');
const OUT = path.join(ROOT, 'favicon.ico');
const SIZES = [16, 32, 48];

(async () => {
    if (!fs.existsSync(SRC)) {
        console.error(`\n❌ المصدر غير موجود: ${path.relative(ROOT, SRC)}\n`);
        process.exit(1);
    }
    const pngs = [];
    for (const s of SIZES) {
        pngs.push({ size: s, buf: await sharp(SRC).resize(s, s, { fit: 'cover' }).png().toBuffer() });
    }

    // ترويسةُ ICO: محجوز(2) + نوع=1(2) + العدد(2) ثمّ ١٦ بايتاً لكلّ صورة.
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
    const dir = Buffer.alloc(16 * pngs.length);
    let offset = 6 + dir.length;
    pngs.forEach((p, i) => {
        const o = i * 16;
        dir[o] = p.size === 256 ? 0 : p.size;      // العرض (٠ تعني ٢٥٦)
        dir[o + 1] = p.size === 256 ? 0 : p.size;  // الارتفاع
        dir[o + 2] = 0;                             // ألوانُ اللوحة (٠ = بلا لوحة)
        dir[o + 3] = 0;                             // محجوز
        dir.writeUInt16LE(1, o + 4);                // المستويات
        dir.writeUInt16LE(32, o + 6);               // بتاتُ البكسل
        dir.writeUInt32LE(p.buf.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += p.buf.length;
    });
    fs.writeFileSync(OUT, Buffer.concat([header, dir, ...pngs.map(p => p.buf)]));
    console.log(`✅ favicon.ico — ${SIZES.join('·')} بكسل · ${fs.statSync(OUT).size} بايت`);
})();
