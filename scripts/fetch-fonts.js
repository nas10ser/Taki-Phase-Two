#!/usr/bin/env node
/**
 * fetch-fonts.js — ينزّل خطَّ تجوال من قوقل **مرّةً** لنستضيفه ذاتياً.
 * ═══════════════════════════════════════════════════════════════════════════
 * يُشغَّل عند تغيير الأوزان المطلوبة وحده:  node scripts/fetch-fonts.js
 *
 * 🪤 ولا تُكتب عناوينُ ملفّات woff2 في الكود: قوقل يبصمها فتتغيّر عند أي
 *    تحديثٍ للخطّ. يُطلب ملفُّ CSS ثمّ تُستخرج العناوينُ **ونطاقاتُ المحارف**
 *    منه — وتخمينُ `unicode-range` يُسقط محارفَ بلا أي خطأ ظاهر.
 * 🪤 ويلزم وسمُ متصفّحٍ حديث: بلا `User-Agent` يردّ قوقل بـ`truetype`
 *    (أكبرَ ثلاثَ مرّات) لا `woff2`.
 */
const fs = require('fs');
const path = require('path');

const WEIGHTS = [400, 500, 700, 800, 900];   // ٣٠٠ أُسقط: صفرُ استعمال (قِيس)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OUT = path.resolve(__dirname, '..', 'fonts');

(async () => {
    const url = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@'
              + WEIGHTS.join(';') + '&display=swap';
    const css = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => {
        if (!r.ok) throw new Error('CSS: HTTP ' + r.status);
        return r.text();
    });

    const blocks = [...css.matchAll(
        /\/\*\s*([a-z0-9\-[\]]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)];
    if (!blocks.length) throw new Error('لم تُستخرج أي كتلة @font-face — تغيّرت صيغةُ قوقل.');

    fs.mkdirSync(OUT, { recursive: true });
    let n = 0;
    for (const [, subset, body] of blocks) {
        const w = /font-weight:\s*(\d+)/.exec(body);
        const u = /url\((https:\/\/[^)]+\.woff2)\)/.exec(body);
        if (!w || !u) continue;
        const buf = Buffer.from(await fetch(u[1], { headers: { 'User-Agent': UA } })
            .then((r) => r.arrayBuffer()));
        // wOF2 — بصمةُ الملفّ تُفحص: صفحةُ خطأٍ بـ200 تُحفظ ملفّاً سليمَ الاسم.
        if (buf.slice(0, 4).toString() !== 'wOF2') {
            throw new Error(`${subset}-${w[1]}: ليس woff2 (${buf.length} بايت)`);
        }
        const f = path.join(OUT, `tajawal-${subset}-${w[1]}.woff2`);
        fs.writeFileSync(f, buf);
        console.log(`  ${path.basename(f).padEnd(32)} ${String(buf.length).padStart(7)} بايت`);
        n++;
    }
    const want = WEIGHTS.length * 2;        // عربيّ + لاتينيّ لكل وزن
    if (n !== want) throw new Error(`نُزّل ${n} ملفّاً والمتوقَّع ${want}`);
    console.log(`✅ ${n} ملفّاً في fonts/ — ولا يُنزّل منها المتصفّحُ إلا ما يُستعمل.`);
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
