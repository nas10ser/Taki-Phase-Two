#!/usr/bin/env node
/**
 * حارسُ لونِ الهويّة (v16.14) — node scripts/check-brand-color.js
 *
 * ── العيبُ الذي يحرسه ───────────────────────────────────────────────────
 * لونُ هويّة التطبيق مكتوبٌ في **أربعة** مواضع لا موضعٍ واحد:
 *   ① `scripts/lib/logo_build.py` — الخلفيةُ المحروقةُ داخل بكسلات الأيقونة.
 *   ② `manifest.webmanifest` — `background_color` (شاشةُ الإقلاع).
 *   ③ `manifest.webmanifest` — `theme_color`.
 *   ④ `index.html` — وسمَا `theme-color` و`msapplication-TileColor`.
 * وثلاثةٌ منها نصٌّ والرابعُ **بايتاتُ صورة**. فتعديلُ النصّ بلا إعادةِ بناءِ
 * الأيقونات يُنتج شاشةَ إقلاعٍ بلونٍ وأيقونةً بلونٍ آخر — وهو عيبٌ لا يظهر
 * في أيّ فحصٍ نصّيّ ولا في أيّ بناءٍ أخضر، ويراه المستخدمُ وحده عند الفتح.
 *
 * 🪤 ولذلك **يُقرأ البكسلُ نفسُه**: يُفَكّ ترميزُ `logo512.png` بـzlib المدمج
 *    (بلا أيّ اعتماد، فـVercel تبني بلا python)، ويُقارَن أوّلُ بكسلٍ في
 *    الزاوية — وهي خلفيةٌ خالصةٌ لأن الرسمةَ عند ٠٫٦٨ من الضلع وسطاً.
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذا الملفُّ يذكر الأسماءَ التي يبحث عنها.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const B = (p) => fs.readFileSync(path.join(__dirname, '..', p));
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*#[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

/** أوّلُ بكسلٍ في PNG ٨‑بت (RGB أو RGBA) — فكُّ ترميزٍ كاملٌ للسطر الأوّل. */
function firstPixel(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ليس PNG');
    let off = 8, ihdr = null;
    const idat = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.slice(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4),
                     depth: data[8], color: data[9], interlace: data[12] };
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (!ihdr) throw new Error('بلا IHDR');
    if (ihdr.depth !== 8) throw new Error('عمقٌ غير مدعوم: ' + ihdr.depth);
    if (ihdr.interlace !== 0) throw new Error('PNG متشابك');
    const ch = ihdr.color === 6 ? 4 : ihdr.color === 2 ? 3 : 0;
    if (!ch) throw new Error('نمطُ لونٍ غير مدعوم: ' + ihdr.color);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const ft = raw[0];                       // مرشّحُ السطر الأوّل
    const row = raw.slice(1, 1 + ihdr.w * ch);
    // السطرُ الأوّل: المرجعُ العلويّ أصفار ⇒ Sub/Paeth ينحدران إلى اليسار وحده،
    // وأوّلُ بكسلٍ لا يسارَ له ⇒ قيمتُه الخام في كلّ المرشّحات الخمسة.
    if (ft > 4) throw new Error('مرشّحٌ غير معروف: ' + ft);
    return [row[0], row[1], row[2]];
}

const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const parse = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

console.log('\nلونُ هويّة التطبيق — مصدرٌ واحدٌ في أربعة مواضع');

// ① المصدرُ المعلَن في مولّد الأيقونات
const py = strip(R('scripts/lib/logo_build.py'));
const m = /BRAND_BG\s*=\s*\((\d+),\s*(\d+),\s*(\d+)\)/.exec(py);
check('مولّدُ الأيقونات يعلن BRAND_BG', !!m, 'لم أجد BRAND_BG في logo_build.py');
if (!m) { console.log(`\n❌ ${pass} ناجح · ${++fail} فاشل\n`); process.exit(1); }
const want = [Number(m[1]), Number(m[2]), Number(m[3])];
console.log(`     المرجع: ${hex(want)}`);

// ② البكسلُ المحروقُ في الأيقونات — قياسٌ لا نصّ
for (const f of ['logo512.png', 'logo192.png', 'apple-touch-icon.png']) {
    let got = null, err = '';
    try { got = firstPixel(B(f)); } catch (e) { err = e.message; }
    check(`${f}: بكسلُ الخلفية يطابق BRAND_BG`,
        !!got && got[0] === want[0] && got[1] === want[1] && got[2] === want[2],
        got ? `وجدتُ ${hex(got)} والمطلوب ${hex(want)} — أعِد: node scripts/build-logo.js` : err);
}

// ③ البيان
const man = JSON.parse(R('manifest.webmanifest'));
for (const k of ['background_color', 'theme_color']) {
    const v = String(man[k] || '');
    check(`manifest.${k} يطابق`, /^#[0-9a-fA-F]{6}$/.test(v)
        && parse(v).every((c, i) => c === want[i]), `${k} = ${v}`);
}

// ④ index.html
const html = strip(R('index.html'));
const metas = [...html.matchAll(/<meta\s+name="(?:theme-color|msapplication-TileColor)"\s+content="(#[0-9a-fA-F]{6})"/g)]
    .map(x => x[1]);
check('index.html فيه وسومُ اللون الثلاثة', metas.length === 3, `وجدتُ ${metas.length}`);
check('وكلُّها تطابق BRAND_BG',
    metas.length > 0 && metas.every(v => parse(v).every((c, i) => c === want[i])),
    `القيم: ${metas.join(' · ')}`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
