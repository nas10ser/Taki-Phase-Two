#!/usr/bin/env node
/**
 * test-bot-disclosure-render.js — الإفصاحُ يظهر ويختفي **فعلاً** (v16.57)
 * ═══════════════════════════════════════════════════════════════════════════
 * `check-bot-disclosure.js` يحرس **الارتباط** (أن كلَّ موضعٍ قريبٌ من `botsOn`)
 * وهو وكيلٌ لا برهان: شرطٌ معكوسٌ أو موضعٌ خارج الشرط يمرّ منه. وهذا الملفّ
 * يُجيب السؤالَ الذي أمر به ناصر حرفياً: **ماذا يقرؤه الزائرُ في الحالتين؟**
 *
 * فتُصيَّر `Privacy.tsx` مرّتين — بالمفتاحين مشغَّلين ثمّ مطفأين — ويُقرأ النصُّ
 * المخرَج. والخطأُ في الاتجاهين خطأٌ واحدٌ معكوس:
 *   · نصٌّ يَعِد بقناةٍ مطفأة  ⇒ وعدٌ لا ينفّذه الكود (درس v14.82).
 *   · أو معالجةٌ بلا إفصاح    ⇒ وهو ما وُضع له حارسُ القاعدة.
 *
 * 🪤 ولا يُلمس أيُّ مفتاحٍ على الإنتاج لإثبات هذا: تبديلُ قناةٍ حقيقيّةٍ
 *    لأجل اختبارٍ هو بالضبط ما مسح عنوانَي التواصل في v14.x.
 * 🪤 والترجمةُ `transpileModule` بلا تحقّقِ أنواع: المطلوبُ تشغيلُ المكوّن لا
 *    فحصُه (و`tsc --noEmit` في السلسلة يفحصه أصلاً). فلا يُسحب رسمُ الاستيراد
 *    كلُّه — تُصنع البدائلُ للسياق والمسار وحدها.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nإفصاحُ القناتين — يظهر ويختفي (تصييرٌ حقيقيّ)');

const ts = require(path.join(root, 'node_modules', 'typescript'));
const React = require(path.join(root, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(path.join(root, 'node_modules', 'react-dom', 'server'));

/** يُترجم ملفَّ TSX ويُنفّذه بمُحمِّلٍ خاصٍّ يُستبدل فيه ما لا يُراد تشغيله. */
// 🪤 و`__esModule: true` إلزاميّ على كلّ بديلٍ له تصديرٌ افتراضيّ: بدونه يلفّه
//    `__importDefault` مرّةً ثانيةً فيصير المكوّنُ **كائناً** لا دالّة، ويسقط
//    التصيير بـ«type is invalid». (وقع فعلاً في أوّل تشغيل.)
const STUBS = {
    'react': React,
    'react-router-dom': {
        Link: (p) => React.createElement('a', { href: p.to }, p.children),
        NavLink: (p) => React.createElement('a', { href: p.to }, p.children),
        useHistory: () => ({ push: () => {}, replace: () => {}, goBack: () => {} }),
        useNavigate: () => () => {},
        useLocation: () => ({ pathname: '/privacy', search: '', hash: '' }),
        useParams: () => ({}),
    },
    '../../components/AnalyticsToggleRow': { __esModule: true, default: () => null },
    '../../components/OperatorIdentityBlock': { __esModule: true, default: () => null },
    '../../data/operatorIdentity': { useOperatorIdentity: () => ({ legalName: '', vatNumber: '', crNumber: '', emails: {} }) },
};
let SETTINGS = null, LANG = 'ar';
STUBS['../../context/AppContext'] = { useApp: () => ({ language: LANG, platformSettings: SETTINGS }) };

const cache = new Map();
const load = (file, fromDir) => {
    const abs = path.resolve(fromDir, file);
    const real = ['', '.tsx', '.ts'].map(e => abs + e).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!real) throw new Error('غيرُ موجود: ' + abs);
    if (cache.has(real)) return cache.get(real);
    const js = ts.transpileModule(fs.readFileSync(real, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const m = new Module(real, null);
    m.filename = real; m.paths = Module._nodeModulePaths(path.dirname(real));
    const dir = path.dirname(real);
    const req = (id) => (id in STUBS) ? STUBS[id]
        : (id.startsWith('.') ? load(id, dir) : require(path.join(root, 'node_modules', id)));
    cache.set(real, m.exports);
    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', js);
    fn(m.exports, req, m, real, dir);
    cache.set(real, m.exports);
    return m.exports;
};

/**
 * المرساةُ جملةٌ من داخل كلّ موضع — «تيليجرام» وحدها تظهر في شاشاتٍ أخرى.
 * 🪤 **وتُفصل باللغة**: الصفحةُ تُصيَّر بلغةٍ واحدةٍ لا بالاثنتين، فأوّلُ صيغةٍ
 *    من هذا الاختبار بحثت عن الإنجليزيّ في مخرَجٍ عربيّ **فاتّهمت كوداً سليماً**
 *    بثلاثة عيوبٍ لا وجودَ لها. (الاختبارُ جزءٌ من العمل.)
 */
const SPOTS = {
    ar: [
        ['نطاقُ السياسة', 'عبر بوت تاكي على تيليجرام وواتساب'],
        ['ما نجمعه', 'بيانات قنوات المراسلة'],
        ['مصادرُ الجمع', 'عبر قنوات المراسلة'],
        ['النقلُ خارج المملكة', 'قناتا المراسلة'],
    ],
    en: [
        ['scope', 'the TAKI bot on Telegram and WhatsApp'],
        ['what we collect', 'Messaging-channel data'],
        ['collection sources', 'Through messaging channels'],
    ],
};

const html = (settings, lang) => {
    SETTINGS = settings; LANG = lang || 'ar'; cache.clear();
    const Privacy = load('../src/pages/legal/Privacy.tsx', __dirname).default;
    return renderToStaticMarkup(React.createElement(Privacy));
};

const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ');

try {
    for (const lang of ['ar', 'en']) {
        const L = lang === 'ar' ? 'عربيّ' : 'إنجليزيّ';

        // ── ① المفتاحان مطفأان ⇒ لا ذكرَ للقناتين إطلاقاً ──────────────────
        const off = strip(html({ telegramBotEnabled: false, whatsappBotEnabled: false }, lang));
        check(`[${L}] الصفحةُ تُصيَّر فعلاً`, off.length > 3000, `طولُ النصّ ${off.length}`);
        for (const [what, needle] of SPOTS[lang]) {
            check(`[${L}] مطفأ ⇒ «${what}» غائب`, !off.includes(needle),
                'أمرُ ناصر: «عند إغلاقها تُحذف» — ونصٌّ يَعِد بقناةٍ مطفأة وعدٌ لا ينفّذه الكود');
        }
        check(`[${L}] ومطفأ ⇒ لا ذكرَ للقناتين في الصفحة كلِّها`,
            !off.includes('تيليجرام') && !off.includes('واتساب') && !/Telegram|WhatsApp/.test(off),
            'بقي ذكرٌ في موضعٍ لم يُشرَط');

        // ── ② وأحدُهما مشغَّل ⇒ المواضعُ تعود ───────────────────────────────
        const on = strip(html({ telegramBotEnabled: true, whatsappBotEnabled: false }, lang));
        for (const [what, needle] of SPOTS[lang]) {
            check(`[${L}] مشغَّل ⇒ «${what}» حاضر`, on.includes(needle),
                'تشغيلُ القناة معالجةٌ لبياناتٍ شخصيّة، فالإفصاحُ شرطُها');
        }

        // ── ③ وواتساب وحدها تكفي (الشرطُ «أو» لا «و») ───────────────────────
        const wa = strip(html({ telegramBotEnabled: false, whatsappBotEnabled: true }, lang));
        check(`[${L}] وتشغيلُ واتساب وحدها يُعيد الإفصاح`, wa.includes(SPOTS[lang][0][1]),
            'الشرطُ يجب أن يكون «أو»: قناةٌ واحدةٌ مشغَّلةٌ تكفي للإفصاح');

        // ── ④ والافتراضُ عند غياب الإعدادات **إخفاء** ───────────────────────
        const none = strip(html(null, lang));
        check(`[${L}] وغيابُ الإعدادات (أوّلُ رسمة) ⇒ إخفاء`,
            !none.includes(SPOTS[lang][0][1]) && none.length > 3000,
            'بـ`!== false` يصير المفتاحُ الغائبُ «مشغَّلاً» فتُعلَن قناةٌ مطفأة');

        // ── ⑤ وما لا يتعلّق بالقناتين لا يتأثّر ─────────────────────────────
        const title = lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy';
        check(`[${L}] وبقيّةُ السياسة لا تتأثّر بالمفتاح`,
            off.includes(title) && on.includes(title) && Math.abs(on.length - off.length) < 4000,
            `طول(مشغَّل)=${on.length} · طول(مطفأ)=${off.length} — فرقٌ كبيرٌ يعني أن الشرطَ غلّف أكثرَ من الإفصاح`);
    }
} catch (e) {
    check('تنفيذُ الصفحة', false, String(e && e.stack || e).slice(0, 700));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
