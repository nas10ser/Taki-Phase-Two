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

/**
 * حزم **الدخول** كما يحمّلها المتصفّح فعلاً — تُقرأ من `dist/index.html`.
 *
 * 🔴 كان هذا الحارس يخمّن الاسم (`^TAKI\.<hash>\.js$`) فمرّ محلياً و**أسقط
 *    ثلاث نشرات على Vercel** برسالة «لم أجد حزمة TAKI في dist». والتخمين خطأ
 *    من أصله: اسمُ حزمة الدخول تفصيلٌ داخليّ في Parcel قد يتغيّر بتغيّر
 *    الإعداد أو البيئة، ولا عقد يضمنه.
 * 🪤 وكشف التصحيحُ أمراً ثانياً: الصفحة تحمّل **حزمتَي دخول لا واحدة**
 *    (`<script type=module src=…>` مرّتين) — فقياسُ أكبرهما كان يُبلّغ رقماً
 *    أصغر من الحقيقة. الميزانية على **مجموعهما**، فهو ما يدفعه الزائر.
 */
function entryBundles() {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const out = [];
    for (const m of html.matchAll(/<script[^>]*\bsrc=["']?\/([^"'\s>]+\.js)/gi)) {
        const f = m[1];
        if (f.startsWith('http')) continue;
        const abs = path.join(dist, f);
        if (fs.existsSync(abs)) out.push({ file: f, size: fs.statSync(abs).size });
    }
    return out;
}

/** أكبر ملفٍّ يطابق البادئة (لحزم المسارات). */
function biggest(prefix) {
    const re = new RegExp(`^${prefix}\\.[A-Za-z0-9]+\\.js$`);
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
        entry: true,         // تُقرأ من dist/index.html لا بتخمين الاسم
        label: 'حزم الدخول (يحمّلها كل زائر)',
        maxKB: 760,          // مجموع حزمتَي الدخول — قِيس بعد إخراج Sentry
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
    let hits;
    if (b.entry) {
        hits = entryBundles();
        if (!hits.length) {
            problems.push(
                'لم أجد أي حزمة دخول مشار إليها في dist/index.html.\n' +
                `     الموجود في dist: ${files.slice(0, 8).join(' · ') || '(لا شيء)'}`
            );
            continue;
        }
    } else {
        const one = biggest(b.prefix);
        if (!one) {
            problems.push(
                `لم أجد حزمة «${b.prefix}» في dist — الحارس يحرس عدماً.\n` +
                `     الموجود: ${files.filter((f) => !/^TAKI\./.test(f)).slice(0, 10).join(' · ')}`
            );
            continue;
        }
        hits = [one];
    }

    const kb = hits.reduce((a, h) => a + h.size, 0) / 1024;
    const names = hits.map((h) => h.file).join(' + ');
    report.push(`   ${b.label}: ${kb.toFixed(0)}KB / ${b.maxKB}KB${hits.length > 1 ? ` (${hits.length} حزم)` : ''}`);
    if (kb > b.maxKB) {
        problems.push(
            `${b.label} = ${kb.toFixed(0)}KB وتجاوزت الميزانية ${b.maxKB}KB (${names}).\n` +
            '     إمّا يُقسَّم الثقيل بـReact.lazy، أو تُرفع الميزانية في هذا الملفّ **بسببٍ مكتوب**.'
        );
    }
    if (b.mustNotContain.length) {
        for (const h of hits) {
            const src = fs.readFileSync(path.join(dist, h.file), 'utf8');
            for (const m of b.mustNotContain) {
                if (src.includes(m.needle)) {
                    problems.push(
                        `«${m.needle}» عاد إلى ${b.label} (${h.file}).\n` +
                        `     ${m.why}\n` +
                        '     غالباً أُعيد استيرادٌ ساكن — يُحوَّل إلى import() ديناميكي.'
                    );
                }
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
