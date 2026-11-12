// ═══════════════════════════════════════════════════════════════════════════
// اختبارُ مسار الصور — هل تمرّ بطاقةُ العرض بالمحوّل الآنيّ أم بالتوأم الثابت؟
// التشغيل:  node scripts/test-image-path.js
//
// 🔴 العيبُ الذي وُلد منه هذا الفحص (قِيس ١١ نوفمبر ٢٠٢٦ من سجلّ
//    `supabase-imgproxy` على الإنتاج): `thumbUrl` كانت تُعيد التوأمَ الثابت
//    في `src`، و`thumbSrcSet` تبني **خمسةَ عناوينِ تحويلٍ آنيّ** في `srcset`
//    لنفس الصورة. و`srcset` يتقدّم على `src` دائماً ⇒ **كلُّ** بطاقةٍ كانت
//    تمرّ بالمحوّل: ١٦٤–٢٢٣ م.ث معالجاً لكلّ صورة، على نواةٍ واحدة.
//    أي أن تحسينَ v14.14 (التوأم الثابت) كان **ميّتاً منذ وُلد**، والجردُ
//    النصّيُّ لا يكشفه لأن كلتا الدالّتين «موجودةٌ وتعمل».
//
// 🪤 والمعيارُ هنا **بنيويّ لا نصّيّ**: لا يكفي أن `thumbUrl` صحيحة —
//    يجب أن يكون `srcset` **فارغاً** متى وُجد توأمٌ مؤكَّد، وإلّا لا أثرَ لها.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', 'src', 'utils', 'thumb.ts');

/** يُحمّل `thumb.ts` كوحدةٍ قابلةٍ للنداء، مع إمكان حقنِ كسرةٍ في مصدره. */
const load = (mutate) => {
    let code = fs.readFileSync(SRC, 'utf8');
    if (mutate) {
        const before = code;
        code = mutate(code);
        if (code === before) throw new Error('الكسرةُ لم تُحقن — الفحصُ سيمرّ كاذباً');
    }
    const js = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText;
    const m = { exports: {} };
    new Function('module', 'exports', 'require', js)(m, m.exports, require);
    return m.exports;
};

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && extra !== undefined) console.log('       ' + extra);
    ok ? pass++ : fail++;
};

const BASE = 'https://api.takisa.net/storage/v1/object/public/deals/';
const MARKED   = `${BASE}1780071957465_ph0cdkk4s4.jpg?t=1`;   // له توأمٌ مؤكَّد
const UNMARKED = `${BASE}1770000000000_old.jpg`;              // لا توأمَ له
const BOTIMG   = `${BASE}bot/1780071957465_x.jpeg?t=1`;       // صورةُ بوتٍ موسومة
const FOREIGN  = 'https://images.unsplash.com/photo-123.jpg';

console.log('🖼  مسارُ صور البطاقات\n');

const T = load();

// ── ① التوأمُ الثابتُ هو ما يُطلب فعلاً ───────────────────────────────────
check('الموسومةُ تُعطي توأماً ثابتاً في src',
      T.thumbUrl(MARKED) === `${BASE}1780071957465_ph0cdkk4s4_t.jpg?t=1`,
      T.thumbUrl(MARKED));

check('🔴 والموسومةُ تُعطي srcset فارغاً (وإلّا تقدّم المحوّلُ على التوأم)',
      T.thumbSrcSet(MARKED) === '',
      T.thumbSrcSet(MARKED).slice(0, 90));

check('وصورةُ البوت الموسومة كذلك (مجلّدٌ داخل المسار)',
      T.thumbSrcSet(BOTIMG) === '' && /_t\.jpg/.test(T.thumbUrl(BOTIMG)),
      T.thumbUrl(BOTIMG));

// ── ② وشبكةُ الأمان باقيةٌ لما لا توأمَ له ────────────────────────────────
const unmarkedSet = T.thumbSrcSet(UNMARKED);
check('غيرُ الموسومة تُبقي المحوّل (شبكةُ أمانٍ لا تُمسّ)',
      unmarkedSet.includes('/render/image/') && / 200w,/.test(unmarkedSet),
      unmarkedSet.slice(0, 90));
check('وغيرُ الموسومة لا تطلب ملفَّ _t غيرَ موجود',
      !T.thumbUrl(UNMARKED).includes('_t.jpg'),
      T.thumbUrl(UNMARKED));

// ── ③ ولا تُمسّ صورةٌ ليست في مستودعنا ────────────────────────────────────
check('رابطٌ خارجيّ يبقى كما هو وبلا srcset',
      T.thumbUrl(FOREIGN) === FOREIGN && T.thumbSrcSet(FOREIGN) === '');

// ── ④ الهيرو: القاعدةُ نفسُها كانت مطبَّقةً هناك من قبل ───────────────────
check('الهيرو الموسوم: ملفٌّ ثابتٌ وبلا srcset',
      /_h\.jpg/.test(T.heroUrl(MARKED)) && T.heroSrcSet(MARKED) === '',
      T.heroUrl(MARKED));

// ── ⑤ كسرةٌ مقصودة: تُنزع الحمايةُ ويجب أن يسقط الفحص ─────────────────────
console.log('\n🔨 كسرةٌ مقصودة — إزالةُ حارس التوأم من thumbSrcSet:');
// 🪤 والمرساةُ **فريدة**: نفسُ السطر موجودٌ في `heroSrcSet` أيضاً، وأوّلُ
//    محاولةٍ هنا نزعته من هناك — فبقي حارسُ `thumbSrcSet` قائماً ومرّت
//    «الكسرة» بلا كسر. (وهذا الفحصُ هو ما أمسكها.)
const ANCHOR = "    if (hasThumb(u)) return '';\n    const q = m[3] || '';";
const broken = load((c) => {
    if (c.split(ANCHOR).length - 1 !== 1) throw new Error('المرساةُ ليست فريدة — الكسرةُ غيرُ موثوقة');
    return c.replace(ANCHOR, "    const q = m[3] || '';");
});
const brokenSet = broken.thumbSrcSet(MARKED);
check('الكسرةُ تُعيد المحوّلَ فعلاً (فالحارسُ هو ما يمنعه، لا شيءٌ آخر)',
      brokenSet.includes('/render/image/') && brokenSet !== '',
      brokenSet.slice(0, 90));

// ── ⑥ شبكةُ التوصيل: ماذا يتحوّل وماذا **لا** يتحوّل ───────────────────────
// 🔴 المعيارُ مقيسٌ لا مُفترَض: `render/image` يتفاوض على الصيغة (WebP/JPEG)
//    بنفس `ETag` وبلا `Vary` ⇒ لا يصلح لمخزنٍ مشترك. والملفُّ الثابت لا
//    يتفاوض ⇒ هو وحده ما يمرّ بالشبكة.
console.log('\n🌐 شبكةُ توصيل الصور:');
const C = load();
C.setImageCdnHost('img.takisa.net');

check('المضيفُ ضُبط', C.imageCdnHost() === 'img.takisa.net', C.imageCdnHost());
check('التوأمُ الثابت يتحوّل إلى الشبكة',
      C.thumbUrl(MARKED).startsWith('https://img.takisa.net/storage/v1/object/public/deals/'),
      C.thumbUrl(MARKED));
check('والهيرو الثابت كذلك',
      C.heroUrl(MARKED).startsWith('https://img.takisa.net/storage/v1/object/public/deals/'),
      C.heroUrl(MARKED));
check('🔴 ومسارُ المحوّل **لا** يتحوّل (وإلّا ٤٠٤ ثمّ ارتداد)',
      C.sizedUrl(UNMARKED, 1600).startsWith('https://api.takisa.net/storage/v1/render/image/'),
      C.sizedUrl(UNMARKED, 1600));
check('وهيرو بلا توأمٍ يبقى على الأصل (يمرّ بـsizedUrl)',
      C.heroUrl(UNMARKED).includes('api.takisa.net'),
      C.heroUrl(UNMARKED));
check('ورابطٌ خارجيّ لا يُمسّ', C.cdnUrl(FOREIGN) === FOREIGN);
check('ومسارٌ ليس كائناً عامّاً لا يُمسّ',
      C.cdnUrl('https://api.takisa.net/rest/v1/deals') === 'https://api.takisa.net/rest/v1/deals');

C.setImageCdnHost('');
check('والإطفاءُ يُعيد كلَّ عنوانٍ إلى الأصل',
      C.thumbUrl(MARKED).includes('api.takisa.net') && C.heroUrl(MARKED).includes('api.takisa.net'),
      C.thumbUrl(MARKED));
check('ومضيفٌ بصيغةٍ خاطئة يُهمَل (فلا تنكسر كلُّ صورة)',
      (C.setImageCdnHost('not a host!!'), C.imageCdnHost() === ''), C.imageCdnHost());

// كسرةٌ مقصودة: إزالةُ حارس البادئة يُعيد المحوّلَ إلى الشبكة
console.log('\n🔨 كسرةٌ مقصودة — إزالةُ حارس البادئة من cdnUrl:');
const ANCHOR2 = "    if (!('/' + rest).startsWith(CDN_SAFE_PREFIX)) return url;\n";
const brokenCdn = load((c) => {
    if (c.split(ANCHOR2).length - 1 !== 1) throw new Error('مرساةُ الكسرة ليست فريدة');
    return c.replace(ANCHOR2, '');
});
brokenCdn.setImageCdnHost('img.takisa.net');
check('الكسرةُ تُسرّب المحوّلَ إلى الشبكة فعلاً',
      brokenCdn.sizedUrl(UNMARKED, 1600).includes('img.takisa.net'),
      brokenCdn.sizedUrl(UNMARKED, 1600));

// ── ⑦ حارسٌ بنيويّ: كلُّ srcSet={thumbSrcSet(x)} يقابله src={thumbUrl(x)} ──
console.log('\n🔎 مواضعُ الاستعمال في الواجهة:');
const { walk } = require('./lib/walk');
const files = walk(path.join(__dirname, '..'), ['src'], /\.tsx?$/)
    .filter((f) => !/node_modules/.test(f));
let sites = 0, bad = 0;
for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    const re = /srcSet=\{\s*thumbSrcSet\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(txt))) {
        sites++;
        const arg = m[1].trim();
        // النافذةُ ٨٠٠ محرفٍ حول الموضع تكفي وسمَ <img> كاملاً
        const win = txt.slice(Math.max(0, m.index - 800), m.index + 800);
        if (!win.includes(`thumbUrl(${arg})`)) {
            console.log(`  ✗ ${path.relative(path.join(__dirname, '..'), f)} — srcSet بلا src=thumbUrl(${arg})`);
            bad++;
        }
    }
}
check(`كلُّ ${sites} موضعٍ يقرن srcSet بـsrc=thumbUrl`, bad === 0 && sites > 0, `مواضع=${sites} مخالف=${bad}`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
