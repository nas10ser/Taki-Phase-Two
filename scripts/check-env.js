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
