#!/usr/bin/env node
/**
 * check-env.js — حارس متغيّرات البناء (v14.50)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الثغرة التي يسدّها، مقيسة لا مفترضة: متغيّرات Supabase مضبوطة على Vercel
 * لبيئتَي **Production وDevelopment فقط، ولا شيء على Preview**. ومعنى ذلك أن
 * أي بناء معاينة يُنتج حزمةً تحمل `undefined` مكان عنوان القاعدة — و**البناء
 * ينجح** (خروج صفر) وVercel تُعلّمه READY، ثم تكون الصفحة بيضاء عند أول فتح.
 * لا typecheck ولا build يعترض، لأن الخطأ ليس في الكود بل في غيابه.
 *
 * فالحارس يجعل الفشل **صاخباً وقت البناء** بدل أن يكون صامتاً وقت الاستعمال:
 * يُنادى أوّل أمر في `npm run build`، فينكسر البناء بدل أن يُنشر فراغ.
 *
 * ولماذا يفحص الشكل لا الوجود فقط: مفتاحٌ منسوخٌ ناقصاً أو عنوانٌ بلا بروتوكول
 * يمرّان من فحص «غير فارغ» ثم يسقطان في المتصفّح. فالفحص على الشكل الحقيقي.
 */

/**
 * 🪤 v14.61 — لا يكفي قراءة `process.env`: **Parcel يقرأ `.env` أيضاً**، فقد
 * تكون القيمة سليمةً في الملفّ والفحصُ يقول «غير مضبوط إطلاقاً» — وهو إنذارٌ
 * كاذب يوقف بناءً صحيحاً. حدث فعلاً: `preview-env.js` يكتب `.env` لبناء
 * المعاينة، فرفضه هذا الفحص لأنه لم ينظر فيه. والمطوّر الذي يملك `.env` بلا
 * تصدير في الصدفة كان سيُرفض بنفس الطريقة.
 * فالفحص يقرأ ما سيقرؤه Parcel: البيئة أوّلاً ثم الملفّ.
 */
const fs = require('fs');
const path = require('path');

const fromDotenv = (() => {
    const out = {};
    for (const f of ['.env', `.env.${process.env.NODE_ENV || 'production'}`, '.env.local']) {
        let raw;
        try { raw = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'); } catch { continue; }
        for (const line of raw.split('\n')) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
            if (!m) continue;
            let v = m[2].trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            out[m[1]] = v;
        }
    }
    return out;
})();

/** نفس ترتيب أسبقية Parcel: متغيّر البيئة يسبق الملفّ. */
const readVar = (k) => process.env[k] || fromDotenv[k] || '';

const REQUIRED = [
    {
        key: 'SUPABASE_URL',
        ar: 'عنوان قاعدة البيانات',
        validate: (v) => {
            let u;
            try { u = new URL(v); } catch { return 'ليس عنواناً صالحاً'; }
            if (u.protocol !== 'https:') return `لا بدّ أن يبدأ بـhttps:// (جاء ${u.protocol}//)`;
            if (!u.hostname.includes('.')) return 'اسم المضيف غير مكتمل';
            if (u.pathname !== '/' && u.pathname !== '') return 'لا يُكتب مسار بعد اسم المضيف';
            return null;
        },
    },
    {
        key: 'SUPABASE_ANON_KEY',
        ar: 'المفتاح العام للقاعدة',
        validate: (v) => {
            const parts = v.split('.');
            if (parts.length !== 3) return `المفتاح يجب أن يكون JWT من ثلاثة أجزاء (جاء ${parts.length})`;
            if (v.length < 100) return `قصير جداً (${v.length} محرفاً) — يبدو منقوصاً`;
            try {
                const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
                if (payload.role && payload.role !== 'anon') {
                    // 🔴 حارسٌ لا غنى عنه: مفتاح service_role في حزمة المتصفّح
                    // يمنح كل زائرٍ صلاحية كاملة على القاعدة ويتجاوز RLS كلّه.
                    return `هذا مفتاح «${payload.role}» لا «anon» — لا يُوضع في حزمة المتصفّح أبداً`;
                }
            } catch { return 'الجزء الأوسط ليس JSON صالحاً — المفتاح تالف'; }
            return null;
        },
    },
];

const problems = [];
for (const r of REQUIRED) {
    const raw = readVar(r.key);
    if (!raw || !raw.trim()) {
        problems.push(`${r.key} (${r.ar}) — غير مضبوط إطلاقاً`);
        continue;
    }
    const why = r.validate(raw.trim());
    if (why) problems.push(`${r.key} (${r.ar}) — ${why}`);
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: متغيّرات البيئة ناقصة أو معطوبة\n');
    for (const p of problems) console.error('   • ' + p);
    console.error(`
   لو كان هذا بناء **معاينة** على Vercel: اضبط المتغيّرين لبيئة Preview
   (Vercel ← Settings ← Environment Variables ← اختر Preview).
   ولو كان بناءً محلّياً: انسخ .env.example إلى .env واملأه.

   لماذا يتوقّف البناء بدل أن يمرّ: حزمةٌ بلا عنوان قاعدة تُبنى بنجاح
   وتُنشر وتظهر **صفحة بيضاء** — ولا يوجد فحصٌ آخر يلتقط ذلك.
`);
    process.exit(1);
}

console.log(`✅ متغيّرات البناء سليمة (${REQUIRED.map((r) => r.key).join(' · ')})`);

/**
 * v14.77 — **وإلى أيّ قاعدة؟** الفحص أعلاه يتحقّق من الشكل ولا يقول أبداً إلى
 * أين تتكلّم الحزمة، فيمرّ أخضرَ وهو يبني حزمةً تشير إلى المختبر.
 *
 * 🪤 وهذا ليس افتراضاً: `.env` على جهاز ناصر كان يشير إلى قاعدة المعاينة
 *    (طوكيو). و`npm run build` محلياً يقرأه — فأي تحقّقٍ من `dist` بخادمٍ ثابت
 *    (وهي الطريقة الموصوفة في CLAUDE.md، لأن معاينة Vercel محميّة بـSSO) كان
 *    سيُجرى على قاعدةٍ فارغة ويُستنتج منه ما لا يصحّ عن الإنتاج.
 *
 * فالبناء يقول اسم المضيف دائماً — ويتوقّف إن كان بناءَ **إنتاج** على Vercel
 * يشير إلى قاعدةٍ ليست الإنتاج: تلك كارثةٌ صامتة (الموقع الحيّ على قاعدة
 * مختبر) ولا فحص آخر يلتقطها.
 */
const PROD_DB_HOSTS = [
    'api.takisa.net',
    '141-147-142-147.sslip.io',   // الاسم القديم — ما زال يخدم صور العروض القديمة
];
const dbHost = (() => {
    try { return new URL(readVar('SUPABASE_URL').trim()).hostname; } catch { return ''; }
})();
const isProdDb = PROD_DB_HOSTS.includes(dbHost);
const vercelEnv = process.env.VERCEL_ENV || '(محلّي)';

if (isProdDb) {
    console.log(`   ↳ القاعدة: ${dbHost} — الإنتاج ✅  [البيئة: ${vercelEnv}]`);
} else if (process.env.VERCEL_ENV === 'production') {
    console.error(`
❌ البناء متوقّف: بناء **إنتاج** يشير إلى قاعدةٍ ليست الإنتاج

   القاعدة المطلوبة: ${PROD_DB_HOSTS.join(' أو ')}
   القاعدة الواردة:  ${dbHost || '(غير مقروء)'}

   لو نُشر هذا لكان www.takisa.net يتكلّم مع قاعدةٍ أخرى: لا عروض، ولا حجوزات،
   ولا حساباتٍ — وكلّ ذلك بلا رسالة خطأ واحدة. راجع متغيّرات Production في
   لوحة Vercel قبل إعادة المحاولة.
`);
    process.exit(1);
} else {
    console.log(`   ⚠️ القاعدة: ${dbHost || '(غير مقروء)'} — **ليست الإنتاج** [البيئة: ${vercelEnv}]`);
    console.log('      أي تحقّقٍ من هذه الحزمة يصف تلك القاعدة، لا www.takisa.net.');
}
