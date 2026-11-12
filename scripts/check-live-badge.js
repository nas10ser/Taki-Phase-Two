#!/usr/bin/env node
/**
 * حارسُ «ما يُقاس بعد الالتزام» (v16.14) — node scripts/check-live-badge.js
 *
 * ── العيوبُ الثلاثة التي يحرسها، وكلُّها مقيسةٌ من الإنتاج ───────────────
 *
 * ① **شارةُ «لوحتي» تبقى بعد ختم الطلب** (بلاغُ ناصر ١٢ نوفمبر ٢٠٢٦).
 *    الدليلُ من القاعدة: الطلب `9225912126` خُتم ٢١:٢٢:٢٥ ولقطةُ الشاشة
 *    ٢١:٢٣ والشارةُ ما زالت ١. والسببُ سباقٌ: `completeBooking` يكتب الحالة
 *    محلّياً **تفاؤلاً**، فينزل العدُّ المحلّي ⇒ يعمل الأثرُ فيسأل الخادمَ
 *    **قبل** أن تصله الكتابة ⇒ يردّ ١. ثمّ يصل حدثُ الريل‑تايم بعد الالتزام
 *    فلا يُغيّر عدّاً محلّياً هو صفرٌ أصلاً ⇒ **قائمةُ الاعتماد لا تتغيّر**،
 *    فلا قياسَ ثانياً إلى أن يُعاد تركيبُ السياق («حتى أخرج من التطبيق»).
 *    ⇒ القياسُ يُربط بـ`lastBookingEvent.seq` — وهو لا يزيد إلّا بعد الالتزام.
 *
 * ② **استطلاعُ العروض كلَّ ٣٠ ثانية** كان يُنزِّل ٤٠٬٦٣٦ بايتاً لكلّ جهاز
 *    (قِيس على الإنتاج) ⇒ ٤٫٨ م.ب/ساعة من باقة المستخدم، واستعلامٌ لكلّ
 *    جهازٍ كلَّ ٣٠ ثانية على **نواةٍ واحدة**. ⇒ صار مشروطاً بصحّة القناة.
 *
 * ③ **الخدمةُ العاملة كانت تنسخ كلَّ صورةِ مستودعٍ إلى CacheStorage** —
 *    ومخزونُها يُباد مع كلّ نشرة (`CACHE_NAME`)، فالإصابةُ شبهُ معدومةٍ
 *    والكلفةُ كاملة، وحصّةُ آيفون تمتلئ بصورٍ أصلُها ٢٫٨ م.ب فتُخلى قشرةُ
 *    التطبيق نفسُها. ⇒ صورُ `/public/` تمرّ للمتصفّح، والموقَّعةُ لا تمرّ.
 *
 * 🪤 وفحصُ ③ **تنفيذيّ لا نصّيّ**: تُستخرج دوالُّ التوجيه من `sw.js`
 *    وتُنفَّذ على عناوين حقيقيّة. (درسُ «الفحصُ النصّيّ لا يُثبت حياةَ حارس».)
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ — هذا الملفُّ نفسُه يذكر كلَّ الأسماء
 *    التي يبحث عنها، وقد أمسك حرّاسٌ سابقون تعليقَهم هم سبعَ مرّات.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

/** جسمُ أقربِ `useEffect(` يحوي `needle`، ومعه قائمةُ اعتماده. */
const effectAround = (src, needle) => {
    const hit = src.indexOf(needle);
    if (hit < 0) return null;
    const start = src.lastIndexOf('useEffect(', hit);
    if (start < 0) return null;
    // نوازن الأقواس من `useEffect(` حتى إغلاقها — فلا تمتدّ المطابقة عبر الملفّ.
    let depth = 0, i = src.indexOf('(', start);
    for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    const block = src.slice(start, i + 1);
    const dep = /,\s*\[([^\]]*)\]\s*\)\s*$/.exec(block);
    return { block, deps: dep ? dep[1] : null };
};

console.log('\n① شارةُ الطلبات المفتوحة تُقاس بعد الالتزام');
{
    // 🪤 v16.14 — المنطقُ خرج إلى خطّافه حين رفضت السقّافةُ نموَّ السياق،
    //    فالحارسُ يتبعه. وتُفحص **الحلقةُ كاملةً**: الخطّافُ يقيس على عدّادٍ
    //    مُمرَّر، والسياقُ يُمرّر عدّادَ الريل‑تايم فعلاً — فنصفُها لا يكفي.
    const hook = strip(R('src/context/useOpenOrdersBadge.ts'));
    const ctx = strip(R('src/context/AppContext.tsx'));
    const call = /useOpenOrdersBadge\(([\s\S]{0,220}?)\)\s*;/.exec(ctx);
    check('السياقُ يُمرّر عدّادَ أحداث الحجز إلى الخطّاف',
        !!call && /lastBookingEvent\s*\?\.\s*seq/.test(call[1]),
        call ? `المُمرَّر: ${call[1].replace(/\s+/g, ' ').trim()}` : 'لم أجد نداءَ الخطّاف');
    const eff = effectAround(hook, 'countOpenForStore');
    check('وُجد الأثرُ الذي يقيس الشارة', !!eff && !!eff.deps,
        'لم أجد useEffect يحوي countOpenForStore بقائمة اعتماد');
    if (eff && eff.deps) {
        // الاسمُ المُعتمَد يجب أن يكون **مشتقّاً من حدث ريل‑تايم**، لا من عدٍّ محلّيّ.
        const names = eff.deps.split(',').map(s => s.trim()).filter(Boolean);
        const seqName = names.find(n => /seq/i.test(n));
        check('قائمةُ الاعتماد تحوي عدّادَ أحداث الحجز', !!seqName,
            `القائمة: [${names.join(', ')}] — وبلا عدّادٍ يزيد بعد الالتزام تبقى الشارةُ ميّتة`);
        if (seqName) {
            // العدّادُ مُعاملٌ للخطّاف — فيجب أن يكون في توقيعه، لا متغيّراً محلّياً.
            const sig = /useOpenOrdersBadge\s*=\s*\(([\s\S]*?)\)\s*:/.exec(hook);
            check('ذلك العدّاد مُعاملٌ يأتي من خارج الخطّاف',
                !!sig && new RegExp('\\b' + seqName + '\\b').test(sig[1]),
                sig ? `التوقيع: ${sig[1].replace(/\s+/g, ' ').trim()}` : 'لم أجد توقيعَ الخطّاف');
        }
        check('العدُّ المحلّيُّ باقٍ أرضيّةً (لا يُستبدل بالخادم وحده)',
            /Math\.max\(\s*storeOpenServer\s*,\s*storeOpenLocal\s*\)/.test(hook));
    }
    // وحدثُ الريل‑تايم يجب أن يزيد العدّاد فعلاً.
    check('حدثُ الحجز يزيد العدّادَ في المُستقبِل',
        /bookingEventSeqRef\.current\s*\+=\s*1/.test(ctx) && /setLastBookingEvent\(/.test(ctx));
}

console.log('\n② استطلاعُ العروض مشروطٌ بصحّة القناة');
{
    const ctx = strip(R('src/context/AppContext.tsx'));
    const eff = effectAround(ctx, 'الاستطلاع الدوري') || effectAround(ctx, 'getFeedPage()\n                .then(({ deals: firstPage }) =>');
    const poll = eff ? eff.block : '';
    check('الاستطلاعُ يسأل عن صحّة الريل‑تايم قبل أن يطلب',
        /isHealthy\(\)/.test(poll),
        'بلا هذا الشرط يعود الاستطلاعُ ٤٠ ك.ب كلَّ ٣٠ ثانية لكلّ جهاز');
    check('ومعه نافذةٌ طويلةٌ حين تكون القناةُ سليمة',
        /HEALTHY_INTERVAL/.test(poll) && /lastFeedPullAt/.test(poll));
    const rts = strip(R('src/services/realtimeService.ts'));
    check('isHealthy موجودةٌ وتقيس القنوات لا الوجود',
        /isHealthy\(\)\s*:\s*boolean\s*\{[\s\S]{0,200}findUnhealthyChannel\(\)\s*===\s*null/.test(rts));
}

console.log('\n③ توجيهُ الخدمة العاملة — مُقاسٌ بالتنفيذ');
{
    const SW = R('sw.js');
    const scope = {
        addEventListener() {}, skipWaiting() {}, clients: { claim() {}, matchAll: async () => [] },
        location: { origin: 'https://www.takisa.net' },
    };
    let api;
    try {
        // eslint-disable-next-line no-new-func
        api = new Function('self', 'caches', 'fetch', 'Response',
            SW + '\n; return { isPublicStorageImage, isPrivateStorage, isApi, isAsset };'
        )(scope, {}, () => {}, function () {});
    } catch (e) {
        check('sw.js قابلٌ للتقييم', false, e.message);
    }
    if (api) {
        const U = (p) => new URL('https://api.takisa.net' + p);
        const cases = [
            ['صورةُ عرضٍ عامّة تمرّ للمتصفّح', '/storage/v1/object/public/deals/x_t.jpg', true],
            ['محوّلُ صورةٍ عامّ يمرّ كذلك', '/storage/v1/render/image/public/deals/x.jpg?width=300', true],
            ['رابطٌ موقَّعٌ لا يمرّ أبداً', '/storage/v1/object/sign/chat/x.jpg', false],
            ['مسارُ المصادقة لا يمرّ', '/storage/v1/object/authenticated/chat/x.jpg', false],
            ['نداءُ REST لا يمرّ', '/rest/v1/deals?select=id', false],
        ];
        for (const [name, p, expected] of cases) {
            check(name, api.isPublicStorageImage(U(p)) === expected,
                `isPublicStorageImage('${p}') = ${api.isPublicStorageImage(U(p))} والمتوقَّع ${expected}`);
        }
        check('الموقَّعُ ما زال محسوباً خاصّاً (لا يُخزَّن)',
            api.isPrivateStorage(U('/storage/v1/object/sign/chat/x.jpg')) === true);
        check('ومعالجُ fetch يُعيد التمرير قبل أن يصنّفها ملفّاً ساكناً',
            /isPublicStorageImage\(url\)\)\s*return;/.test(strip(SW)));
    }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
