#!/usr/bin/env node
/**
 * check-seller-top-cards.js — بطاقتا الاشتراك والتوثيق: تبويبان لا ستّة (v16.59)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (٢٥ نوفمبر ٢٠٢٦، بصورة): «أزلها من عروضي والطلبات والتقييمات،
 * وأبقها في صفحتَي إضافة + والتحليلات».
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① 🔴 **قائمةُ منعٍ بدل سماح.** منعُ ثلاثة تبويباتٍ بالاسم يُولد أيَّ تبويبٍ
 *    جديدٍ ومعه البطاقتان — فيعود العيبُ بلا أن يلمسه أحد. فيُقرأ **التبويبُ
 *    الحيُّ من اللوحة نفسِها** ويُشترط أن يصدُق `showsTopCards` على اثنين فقط.
 * ② 🔴 **إخفاءُ ما لم يُطلب إخفاؤه.** `SetupPath` («ما ينقص متجرك») يسكن نفسَ
 *    المكوّن، وهو **عملٌ يمنع البيع** لا بطاقةُ حالة — ويبقى فوق كلّ تبويب
 *    منذ v14.45. وإخفاؤه معهما يُعيد عيباً أُغلق.
 * ③ 🔴 **خاصّيةٌ تُعرَّف ولا تُستعمل.** الغلافُ قد يأخذ `showVerification`
 *    ويُهملها، فيمرّ كلُّ فحصٍ نصّيٍّ والبطاقةُ تظهر كما كانت ⇒ يُشغَّل المكوّن.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحص — ومنه اللاحقُ للكود.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/(?<!:)\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/**
 * 🪤 ويُترجَم ما يُشغَّل **داخل السكربت**: أوّلُ صيغةٍ منه قرأت مخرَجاً بنيتُه
 *    بيدي في `node_modules/.cache-*`، فكانت تعمل على جهاز ناصر وتنفجر على
 *    Vercel (تبني من أرشيفٍ نظيف). لا فحصَ يفترض حالةً محلّيّة.
 */
const ts = require(path.join(root, 'node_modules', 'typescript'));
const loadTs = (rel, stubs) => {
    const file = path.join(root, rel);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const mod = new Module(file, null);
    mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
    new Function('exports', 'require', 'module', '__filename', '__dirname', js)(
        mod.exports, (id) => (stubs && id in stubs) ? stubs[id] : require(id), mod, file, path.dirname(file));
    return mod.exports;
};
const RULE = loadTs('src/components/seller/topCardsRule.ts');

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nبطاقتا الاشتراك والتوثيق — في تبويبَين لا في ستّة');

const DASH = strip(R('src/pages/SellerDashboard.tsx'));

// ── ① القاعدةُ تُقاس على التبويبات **الحيّة** ───────────────────────────────
const m = /\(\[((?:'[a-z]+',?\s*)+)\] as const\)\.map\(tab =>/.exec(DASH);
check('تُقرأ تبويباتُ اللوحة من مصدرها الحيّ', !!m,
    'تعذّر العثورُ على مصفوفة التبويبات — عُدّل شكلُها فلا يصحّ البناءُ على قائمةٍ مكتوبةٍ بيد');
if (m) {
    const tabs = m[1].match(/'([a-z]+)'/g).map(s => s.replace(/'/g, ''));
    const { showsTopCards } = RULE;
    const shown = tabs.filter(showsTopCards);
    const hidden = tabs.filter(t => !showsTopCards(t));
    check(`وتُعرض في «إضافة» و«التحليلات» وحدهما (${shown.join(' · ') || 'لا شيء'})`,
        shown.length === 2 && shown.includes('form') && shown.includes('insights'),
        `ظهرت في: ${shown.join(' · ')} — أمرُ ناصر: صفحتا إضافة + والتحليلات`);
    for (const [ar, t] of [['عروضي', 'products'], ['الطلبات', 'orders'], ['التقييمات', 'reviews']]) {
        check(`و«${ar}» بلا بطاقتين`, hidden.includes(t), 'الصفحاتُ الثلاثُ التي سمّاها ناصر');
    }
    check('والقائمةُ **سماحٌ** لا منع',
        /TOP_CARD_TABS = \['form', 'insights'\] as const/.test(R('src/components/seller/topCardsRule.ts'))
        && /\.includes\(view\)/.test(R('src/components/seller/topCardsRule.ts')),
        'قائمةُ منعٍ تُولد كلَّ تبويبٍ جديدٍ ومعه البطاقتان — المنعُ يفشل مفتوحاً');
    check('ولا تبويبَ غيرُ معروفٍ يُولد ظاهراً',
        tabs.every(t => showsTopCards(t) === (t === 'form' || t === 'insights')),
        `التبويبات الحيّة: ${tabs.join(' · ')}`);
}

// ── ② موضعا التصيير مشروطان، و`SetupPath` **ليس** مشروطاً ─────────────────
check('بطاقةُ الاشتراك مشروطةٌ بالقاعدة',
    /isPaymentEnabled && showsTopCards\(view\) && <SubscriptionStatusCard compact \/>/.test(DASH),
    'كانت تُصيَّر فوق كلّ تبويب (v11.38)');
check('وبطاقةُ التوثيق مشروطةٌ بها نفسِها',
    /<SetupPath [^>]*showVerification=\{showsTopCards\(view\)\}/.test(DASH),
    'شرطان مختلفان يفترقان عند أوّل تعديل');
check('🔴 ومسارُ التهيئة يبقى فوق **كلّ** تبويب',
    /\{user && <SetupPath userId=\{user\.id\}/.test(DASH)
    && !/view === 'form'[^\n]*<SetupPath/.test(DASH),
    'نقصٌ يمنع البيع ليس بطاقةَ حالة — إخفاؤه يُعيد عيبَ v14.45');

// ── ③ والخاصّيةُ **تُستعمل فعلاً** — يُشغَّل الغلاف ────────────────────────
{
    const React = require(path.join(root, 'node_modules', 'react'));
    const { renderToStaticMarkup } = require(path.join(root, 'node_modules', 'react-dom', 'server'));
    const STUBS = {
        'react': React,
        './SetupPath': { __esModule: true, default: () => React.createElement('div', null, 'SETUP_PATH'),
            notifySetupGapsChanged: () => {}, SETUP_GAPS_CHANGED: 'x' },
        './VerificationCard': { __esModule: true, default: () => React.createElement('div', null, 'VERIFICATION_CARD') },
        './topCardsRule': RULE,
    };
    const Stack = loadTs('src/components/seller/SellerSetupStack.tsx', STUBS).default;
    const html = (p) => renderToStaticMarkup(React.createElement(Stack, Object.assign({ userId: 'u', isRTL: true, onGo: () => {} }, p)));

    const on = html({ showVerification: true });
    const off = html({ showVerification: false });
    const dflt = html({});
    check('🔴 وبالتشغيل: `showVerification` تُخفي بطاقةَ التوثيق فعلاً',
        on.includes('VERIFICATION_CARD') && !off.includes('VERIFICATION_CARD'),
        'خاصّيةٌ تُعرَّف ولا تُستعمل تمرّ من كلّ فحصٍ نصّيّ والبطاقةُ تظهر كما كانت');
    check('ومسارُ التهيئة يُصيَّر في الحالتين',
        on.includes('SETUP_PATH') && off.includes('SETUP_PATH'),
        'أُخفي معها ما لم يُطلب إخفاؤه');
    check('والافتراضُ **إظهارٌ** لمن لا يمرّر شيئاً',
        dflt.includes('VERIFICATION_CARD'),
        'افتراضُ الإخفاء يُسقط التوثيقَ عن شاشةٍ بالسهو');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
