#!/usr/bin/env node
/**
 * check-bundle-budget.js — الثِّقل لا يعود بصمت (v14.83)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الثغرة التي يسدّها، مقيسة: `@sentry/react` كان مستورَداً **ساكناً** في
 *    `services/sentry.ts`، و`index.tsx` يستورده عند الإقلاع — فتدخل الحزمة
 *    كاملةً (ومعها Session Replay) في **حزمة الدخول** التي يحمّلها كل زائر،
 *    **حتى حين لا يوجد DSN أصلاً**. ولوحة التاجر كانت ملفاً واحداً ٥٥٥
 *    كيلوبايت. ولا شيء في البناء كان يشتكي: الحزمة تكبر بهدوء إصداراً بعد
 *    إصدار، ولا يُلاحظ إلا حين يشتكي مستخدمٌ من البطء.
 *
 * فالميزانية مكتوبة هنا، ويُفشل البناءُ من يتجاوزها. والرقم ليس ذوقاً:
 * كل ١٠٠ كيلوبايت على شبكة جوال سعودية متوسّطة ≈ ٠٫٣–٠٫٥ ثانية قبل أول محتوى.
 *
 * 🪤 والحارس الأهمّ ليس الحجم بل **الاسم**: `mustNotContain` يمنع عودة حزمةٍ
 *    ثقيلة إلى حزمة الدخول باستيرادٍ ساكن. الحجم وحده يمرّ إن كبرت الحزمة
 *    ١٠ كيلوبايت في كل إصدار — والاسم يمسك السبب مباشرةً.
 * 🪤 ولا git هنا: بناء Vercel أرشيفٌ بلا مستودع (درس v14.80b).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) {
    console.error('✗ لا يوجد dist — يُنادى هذا الفحص بعد البناء.');
    process.exit(1);
}

const files = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));

/** أكبر ملفٍّ يطابق النمط (Parcel يُخرج أكثر من ملفٍّ بنفس البادئة). */
function biggest(prefix) {
    const re = new RegExp(`^${prefix}\\.[a-z0-9]+\\.js$`);
    let best = null;
    for (const f of files) {
        if (!re.test(f)) continue;
        const size = fs.statSync(path.join(dist, f)).size;
        if (!best || size > best.size) best = { file: f, size };
    }
    return best;
}

/**
 * الميزانيات — مقيسة في v14.83 ومعها هامشٌ معقول.
 * تُرفع **عمداً وبسبب مكتوب** لا لتمرير بناءٍ متعثّر.
 */
const BUDGETS = [
    {
        prefix: 'TAKI',
        label: 'حزمة الدخول (يحمّلها كل زائر)',
        maxKB: 700,          // قِيست ٦٢٩ بعد إخراج Sentry (كانت ٨١٣)
        mustNotContain: [
            // عودة استيرادٍ ساكن لأيٍّ من هذه = ثِقلٌ على كل زائر.
            // 🪤 العلامة تُختار من **حرفيّات الحزمة** لا من ندائنا نحن: أوّل
            //    صياغةٍ استعملت `replayIntegration(` فاحمرّ الحارس كذباً —
            //    ذاك ندائي في `services/sentry.ts` وهو في حزمة الدخول بطبيعته،
            //    والتنفيذ في حزمةٍ أخرى. أسماء متغيّراتنا تُصغَّر، وحرفيّاتُ
            //    الحزمة لا تُصغَّر — فهي وحدها دليلٌ صادق.
            //    قِيس: «sentry» = ١٣٠ في حزمة Sentry · ٠ في حزمة الدخول.
            { needle: 'sentry', why: 'Sentry يُحمَّل كسولاً بعد أول رسم (services/sentry.ts)' },
            { needle: '@tensorflow/', why: 'فلترة الصور تُحمَّل عند أول رفعٍ فقط' },
        ],
    },
    {
        prefix: 'SellerDashboard',
        label: 'لوحة التاجر',
        maxKB: 300,          // قِيست ٢٣٥ بعد التقسيم (كانت ٥٤٢)
        mustNotContain: [],
    },
];

const problems = [];
const report = [];

for (const b of BUDGETS) {
    const hit = biggest(b.prefix);
    if (!hit) {
        problems.push(`لم أجد حزمة «${b.prefix}» في dist — هل تغيّر اسم المسار؟ الحارس يحرس عدماً.`);
        continue;
    }
    const kb = hit.size / 1024;
    report.push(`   ${b.label}: ${kb.toFixed(0)}KB / ${b.maxKB}KB`);
    if (kb > b.maxKB) {
        problems.push(
            `${b.label} = ${kb.toFixed(0)}KB وتجاوزت الميزانية ${b.maxKB}KB (${hit.file}).\n` +
            '     إمّا يُقسَّم الثقيل بـReact.lazy، أو تُرفع الميزانية في هذا الملفّ **بسببٍ مكتوب**.'
        );
    }
    if (b.mustNotContain.length) {
        const src = fs.readFileSync(path.join(dist, hit.file), 'utf8');
        for (const m of b.mustNotContain) {
            if (src.includes(m.needle)) {
                problems.push(
                    `«${m.needle}» عاد إلى ${b.label} (${hit.file}).\n` +
                    `     ${m.why}\n` +
                    '     غالباً أُعيد استيرادٌ ساكن — يُحوَّل إلى import() ديناميكي.'
                );
            }
        }
    }
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: ميزانية الحزم\n');
    for (const p of problems) console.error('   • ' + p);
    console.error('');
    process.exit(1);
}

console.log('✅ ميزانية الحزم:');
for (const r of report) console.log(r);
