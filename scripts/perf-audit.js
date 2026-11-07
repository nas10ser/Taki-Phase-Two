#!/usr/bin/env node
/**
 * perf-audit.js — هل التطبيقُ سلسٌ فعلاً؟ بالأرقام.
 * ═══════════════════════════════════════════════════════════════════════════
 * التشغيل:  node scripts/perf-audit.js            (على الإنتاج)
 *           TAKI_PERF_SITE=http://localhost:1234 node scripts/perf-audit.js
 *
 * 🪤 ويُقاس على **جوّالٍ متوسّطٍ مخنوق** لا على الماك: بلا خنقٍ يقول القياسُ
 *    «ممتاز» عن تجربةٍ بطيئةٍ فعلاً، وهو أسوأُ من لا قياس.
 * 🪤 وهذا **ليس اختبارَ حِمل**: صفحاتٌ معدودةٌ تُفتح كزائرٍ عاديّ. واختبارُ
 *    الحِمل على الإنتاج ممنوعٌ منعاً باتّاً (أسقط الموقعَ خمسَ ساعاتٍ مرّة).
 */
const { probe } = require('./lib/perf-probe');

const SITE = process.env.TAKI_PERF_SITE || 'https://www.takisa.net';

const PAGES = [
    { slug: 'الرئيسية',  url: '/',       wait: 14000 },
    { slug: 'العروض',    url: '/deals',  wait: 14000 },
    { slug: 'حولي',      url: '/nearby', wait: 14000 },
];

// مدينةٌ محفوظةٌ كي لا تُقاس بوّابةُ «وين مدينتك؟» بدل الصفحة.
const SEED = {
    'taki_home_city': JSON.stringify({ regionId: 'riyadh', cityId: 'riyadh' }),
    'taki_live_loc_dismissed': '1',
    'taki_initialized_v8': 'true',
};

// محاكاةُ جوّالٍ متوسّطٍ على ٤G — نفسُ إعداد أدوات قوقل الرسميّة.
const MOBILE_4G = {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
};

/** عتباتُ قوقل المعلنة — «جيّد» و«يحتاج تحسيناً». */
const BUDGET = {
    lcp:  [2500, 4000, 'م.ث', 'متى يرى المستخدمُ أكبرَ عنصر'],
    tbt:  [200,  600,  'م.ث', 'كم كان الخيطُ الرئيسيّ لا يستجيب'],
    cls:  [0.1,  0.25, '',    'كم ترتجّ الصفحةُ تحت إصبعه'],
    fcp:  [1800, 3000, 'م.ث', 'أوّلُ شيءٍ يُرسم'],
};

const verdict = (k, v) => {
    const b = BUDGET[k]; if (!b) return '';
    return v <= b[0] ? '✅' : (v <= b[1] ? '🟡' : '🔴');
};

(async () => {
    console.log(`القياس على: ${SITE}`);
    console.log('الجهازُ المُحاكى: جوّالٌ ٣٩٠×٨٤٤ · معالجٌ مخنوقٌ ٤× · شبكةُ ٤G (١٫٦ م.بت/ث · ١٥٠ م.ث)\n');

    let rows;
    try {
        rows = await probe({ site: SITE, pages: PAGES, seed: SEED, cpu: 4, net: MOBILE_4G });
    } catch (e) {
        console.error('❌ تعذّر القياس:', e.message); process.exit(1);
    }

    // 🔴 **لا يُقرأ رقمٌ قبل إثبات أن المقيسَ تطبيقُنا.** جرى قياسٌ كاملٌ
    //    وخرج بـ«✅ FCP ٩٠٤ · TBT ٢٦ · CLS ٠٫٠٠٤» وهو يقيس صفحةَ تحدّي
    //    روبوتاتٍ من فيرسِل (طلبٌ واحد · ١٥ ك.ب · ٢٣ عقدة). ولو قُرئت تلك
    //    الأرقامُ لقيل «تحسّنٌ هائل» عن جدارٍ لا عن موقع.
    //    🪤 ولا يُفحص بـ«هل فيه #root»: صفحةُ التحدّي قد تحمل أيّ وسم. العقدُ
    //       الصادق: **حزمةُ TAKI محمَّلة** و#root فيه أبناء.
    for (const r of rows) {
        if (r.error) continue;
        const m = r.appMarkers || {};
        if (!m.takiBundle || !m.rootKids) {
            console.error(`\n🔴 القياسُ باطل على «${r.page}»: الصفحةُ المحمَّلة ليست تاكي.`);
            console.error(`   العنوان: «${m.title || '(بلا)'}» · حزمُ TAKI: ${m.takiBundle || 0}`
                        + ` · أبناءُ #root: ${m.rootKids || 0} · طلبات: ${r.requests} · ${r.kb} ك.ب`);
            console.error('   السببُ الغالب: جدارُ فيرسِل بعد استجوابٍ متكرّر للإنتاج —');
            console.error('   يُنتظر قليلاً، أو يُقاس على نسخةٍ محلّية:');
            console.error('     node scripts/serve-dist.js &  ثمّ');
            console.error('     TAKI_PERF_SITE=http://127.0.0.1:4321 node scripts/perf-audit.js');
            process.exit(1);
        }
    }

    let worst = 0;
    for (const r of rows) {
        if (r.error) { console.log(`\n■ ${r.page}: ❌ ${r.error}`); worst = 2; continue; }
        console.log(`\n■ ${r.page}`);
        for (const k of ['fcp', 'lcp', 'tbt', 'cls']) {
            const b = BUDGET[k];
            const mark = verdict(k, r[k]);
            if (mark === '🔴') worst = Math.max(worst, 2);
            else if (mark === '🟡') worst = Math.max(worst, 1);
            console.log(`   ${mark} ${k.toUpperCase().padEnd(4)} ${String(r[k]).padStart(7)} ${b[2].padEnd(4)} ` +
                        `(جيّد ≤ ${b[0]})   ${b[3]}`);
        }
        console.log(`     مهامُّ طويلة: ${r.longTasks} (أطولُها ${r.longest} م.ث) · ` +
                    `عقدُ DOM: ${r.nodes} · ذاكرة: ${r.heapMb} م.ب`);
        console.log(`     نُقل: ${r.kb} ك.ب (جافاسكربت ${r.kbJs} · صور ${r.kbImg}) في ${r.requests} طلباً`);
        const s = r.scroll || {};
        // 🪤 والحكمُ على **تخطّي الإطار** (٣٣ م.ث) لا على تجاوز ١٦٫٧:
        //    إطارٌ بـ١٧ م.ث سليمٌ تماماً، وعدُّه «متأخّراً» ضجيجٌ لا جنك.
        // 🪤 وسقفُ المُحاكي لا يُحسب تقطيعاً: المتصفّحُ بلا رأسٍ هنا مسقوفٌ
        //    عند ٣٠ هرتز، فتصير كلُّ إطاراته ٣٣ م.ث و«١٠٠٪ متخطّاة» — وهو
        //    حدٌّ في الأداة لا عيبٌ في الصفحة، وإنذارٌ عليه ضجيج.
        if (s.vsyncCapped) {
            console.log(`   ℹ️ التمرير: ${s.fps} إطاراً/ث بانتظامٍ تامّ (p50=${s.p50} · أسوأ ${s.worst})`);
            console.log('      ⇒ المتصفّحُ بلا رأسٍ مسقوفٌ عند ٣٠ هرتز — السلاسةُ لا تُقاس هنا،'
                      + ' تُقاس على جوّالٍ حقيقيّ.');
        } else {
        const smooth = (s.stallPct ?? 100) <= 2 ? '✅' : ((s.stallPct ?? 100) <= 8 ? '🟡' : '🔴');
        if (smooth === '🔴') worst = 2; else if (smooth === '🟡') worst = Math.max(worst, 1);
        console.log(`   ${smooth} التمرير: ${s.fps} إطاراً/ث · ${s.stallPct}% إطاراتٍ مُتخطّاة · ` +
                    `${s.latePct}% فوق ٢٠ م.ث · أسوأ ${s.worst} م.ث · مُرّر ${s.scrolled}px`);
        }
        if ((s.scrolled || 0) < 100) console.log('     ⚠️ الصفحةُ لم تُمرَّر فعلاً — قياسُ التمرير لا يعني شيئاً هنا.');

        if (r.profile) {
            console.log(`     أين ذهب الخيطُ الرئيسيّ (${r.profile.totalMs} م.ث مُحلَّلة):`);
            for (const f of r.profile.files) console.log(`        ${String(f.ms).padStart(6)} م.ث  ${f.file}`);
            if (r.profile.top.length) {
                console.log('     أثقلُ الدوالّ:');
                for (const t of r.profile.top.slice(0, 6))
                    console.log(`        ${String(t.ms).padStart(6)} م.ث  ${t.fn}  ← ${t.url}`);
            }
        }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(worst === 0 ? '✅ سلسٌ ضمن عتبات قوقل في كل ما قِيس.'
              : worst === 1 ? '🟡 مقبولٌ وفيه ما يُحسَّن.'
              : '🔴 فيه ما يُبطئ التجربةَ فعلاً — التفاصيلُ أعلاه.');
})();
