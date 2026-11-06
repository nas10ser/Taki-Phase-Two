#!/usr/bin/env node
/**
 * build-store-screenshots.js — لقطاتُ المتجرين بالمقاسات التي تفرضها المتاجر.
 * ═══════════════════════════════════════════════════════════════════════════
 * التشغيل:  node scripts/build-store-screenshots.js
 *
 * 🔴 **المقاساتُ ليست اقتراحاً**: App Store Connect يرفض الرفعَ إن لم تكن
 *    اللقطةُ بالعرض والارتفاع بالضبط — بالبكسل لا بالنسبة. وقوقل تسقّف
 *    الضلعَ الأقصر بـ٣٢٠ والأطولَ بـ٣٨٤٠ وتشترط ٢–٨ لقطات.
 *
 * 🪤 ولا تُلتقط بتصغيرِ لقطةٍ كبيرة: التصغيرُ يُنتج نصّاً عربياً مشوّشاً،
 *    وأبل ترفض اللقطاتِ «المُمطَّطة». كلُّ مقاسٍ يُصوَّر بعرضِ نافذةٍ حقيقيّ
 *    ومعامل كثافةٍ صحيح، فيُعاد تخطيطُ الصفحة له.
 *
 * 🪤 والمصدرُ هو **الموقعُ الحيّ**: التطبيقُ يعرض نفسَ الواجهة حرفياً
 *    (حزمةٌ محليّةٌ من نفس `dist`)، فاللقطةُ صادقةٌ لا تمثيليّة. ولقطةٌ لا
 *    تطابق ما يراه المستخدم سببُ رفضٍ عند المتجرين معاً.
 */
const { capture } = require('./lib/cdp-shot');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store', 'screenshots');
const SITE = process.env.TAKI_SCREENSHOT_SITE || 'https://www.takisa.net';

// الوجهاتُ: شاشاتٌ عامّةٌ لا تحتاج تسجيلَ دخول، وتُظهر ما يفعله التطبيق.
const PAGES = [
    { slug: 'home',   url: '/',       wait: 7000 },
    { slug: 'deals',  url: '/deals',  wait: 8000 },
    { slug: 'nearby', url: '/nearby', wait: 7500 },
];

// 🔴 الآيباد لا يُصوَّر على الخريطة: قِيس أنها **تتعثّر دائماً** عند
//    ٢٠٦٤×٢٧٥٢ (٥٫٧ ميجابكسل مع لوحة بلاطاتٍ حيّة) — تجمّدٌ في المحرّك لا
//    خطأٌ يُعالَج. وصفحةُ العرض أنسبُ للمتجر أصلاً: تُظهر المنتجَ والسعرَ
//    وزرَّ الحجز، أي **ما يفعله التطبيق** لا أين يقع.
const PAGES_IPAD = [
    { slug: 'home',  url: '/',       wait: 7000 },
    { slug: 'deals', url: '/deals',  wait: 8000 },
    { slug: 'deal',  url: '/deal/1780072084641', wait: 8000 },
];

/**
 * المقاسات. العرضُ المنطقيُّ × الكثافة = البكسل المطلوب بالضبط.
 * • آيفون ٦٫٩ بوصة (١٦ Pro Max): ١٣٢٠×٢٨٦٨ = 440×956 @3x
 * • آيفون ٦٫٥ بوصة (احتياطيّ)  : ١٢٤٢×٢٦٨٨ = 414×896 @3x
 * • آيباد ١٣ بوصة              : ٢٠٦٤×٢٧٥٢ = 1032×1376 @2x
 * • جوّال أندرويد               : ١٠٨٠×٢٣٤٠ = 360×780 @3x
 */
const SIZES = [
    { name: 'ios-6.9',     w: 440,  h: 956,  dpr: 3, px: [1320, 2868] },
    { name: 'ios-6.5',     w: 414,  h: 896,  dpr: 3, px: [1242, 2688] },
    { name: 'ios-ipad-13', w: 1032, h: 1376, dpr: 2, px: [2064, 2752], mobile: false },
    { name: 'android',     w: 360,  h: 780,  dpr: 3, px: [1080, 2340] },
];

/**
 * 🔴 بذرةُ التخزين المحلّي: بلا مدينةٍ محفوظة تفتح بوّابةُ «وين مدينتك؟»
 *    فوق الشاشة — وقد وقع ذلك فعلاً في أوّل محاولة، فخرجت اثنتا عشرة لقطةً
 *    كلُّها نافذةُ إذنٍ لا منتج. والمتجران يرفضان لقطةً تُظهر حاجزاً.
 *    والمدينةُ هنا **الرياض**: أكبرُ سوقٍ وأكثرُها عروضاً، فاللقطةُ تمتلئ.
 */
const SEED = {
    'taki_home_city': JSON.stringify({ regionId: 'riyadh', cityId: 'riyadh' }),
    'taki_live_loc_dismissed': '1',
    'taki_initialized_v8': 'true',
};

(async () => {
    // 🔴 **متصفّحٌ مستقلٌّ لكلّ مقاس** — آخرُ درسٍ في هذه السلسلة: حين تتجمّد
    //    لقطةٌ واحدة لا يتعافى **المتصفّحُ كلُّه**، لا الصفحةُ وحدها. جُرّبت
    //    صفحةٌ جديدةٌ لكلّ لقطة فبقي العطلُ ينتقل (٨ من ١٢). وبعزل العمليّة
    //    يصير أسوأُ ما يحدث: مقاسٌ واحدٌ يسقط والباقي سليم.
    //    والكلفةُ أربعُ عمليّاتِ متصفّحٍ بدل واحدة — دقائقُ معدودة.
    const shots = [];
    for (const size of SIZES) {
        try {
            const pages = size.name.includes('ipad') ? PAGES_IPAD : PAGES;
            shots.push(...await capture({ site: SITE, pages, sizes: [size], seed: SEED, outDir: OUT }));
        } catch (e) {
            console.error(`   ❌ المقاس ${size.name}: ${e.message}`);
            for (const p of (size.name.includes('ipad') ? PAGES_IPAD : PAGES)) shots.push({ name: `${size.name}/${p.slug}`, w: 0, h: 0, want: size.px, bytes: 0 });
        }
    }

    let ok = 0, bad = 0;
    for (const s of shots) {
        const sizeOk = s.w === s.want[0] && s.h === s.want[1];
        const fullOk = s.bytes > 20000;      // لقطةٌ شبهُ فارغةٍ تمرّ بفحص المقاس وحده
        console.log(`   ${sizeOk && fullOk ? '✓' : '❌'} ${s.name.padEnd(22)} ${s.w}×${s.h}  ${(s.bytes/1024).toFixed(0)} ك.ب` +
                    (sizeOk ? '' : `  (المطلوب ${s.want[0]}×${s.want[1]})`) +
                    (fullOk ? '' : '  — لقطةٌ شبهُ فارغة'));
        if (sizeOk && fullOk) ok++; else bad++;
    }
    console.log(`\n${bad ? '❌' : '✅'} اللقطات: ${ok} سليمة · ${bad} فاشلة · في store/screenshots/`);
    if (bad) { console.error('   🪤 ومقاسٌ خاطئٌ واحد يكفي لرفض الرفعة كلِّها عند أبل.'); process.exit(1); }
})();
