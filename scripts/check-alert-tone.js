#!/usr/bin/env node
/**
 * check-alert-tone.js — إنذارُ الطلب: يُسمع · لا يسكت · ويسكت حين يُجاب (v16.58)
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① 🔴 **`new Audio()` لكلّ نغمة ⇒ صوتٌ لا يُسمع.** الإذنُ يُمنح **للعنصر
 *    الذي لمسه المستخدم**، وعنصرٌ يُولد لحظةَ الحدث لا يرثه فتُرفض `play()`
 *    بصمت. وهذا سببُ بلاغ ناصر الأوّل: الصوتُ في الكود منذ v16.02 ولا يُسمع.
 * ② 🔴 **`setInterval` للتكرار ⇒ «تسكت على طول».** فجوةُ الصمت تُسمع سكوتاً،
 *    و**كروم يُبطّئ مؤقّتاتِ التاب الخلفيّ** إلى نحو واحدةٍ في الدقيقة — أي
 *    يخنق الإنذارَ في اللحظة التي يكون التاجرُ فيها مشغولاً. والعلاجُ ملفٌّ
 *    بـ`loop`: تشغيلُ الوسائط لا يُبطّأ.
 * ③ 🔴 **إنذارٌ لكلّ طلب ⇒ تشويش.** عشرةُ طلباتٍ = عشرُ نغماتٍ متراكبة.
 *    فالإنذارُ حالةٌ واحدة: «هل ينتظرني شيء؟».
 * ④ 🔴 **نغمةٌ على ما كتبتَه أنت** — فالشرطُ على الوارد وحده.
 * ⑤ **وتكرارٌ للمشتري**: هو يعرف أنه حجز للتوّ؛ الإنذارُ للتاجر وحده.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحص — **ومنه اللاحقُ للكود**: أوّلُ تشغيلٍ
 *    لهذا الحارس سقط على تعليقٍ في `AppContext` يذكر `new Audio()`.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
/** 🪤 و`(?<!:)` تحمي `https://` من أن يُقطع نصفُ السطر عنده. */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/(?<!:)\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

const SND  = strip(R('src/services/notificationSound.ts'));
const HOOK = strip(R('src/hooks/useOrderAlertTone.ts'));
const CTX  = strip(R('src/context/AppContext.tsx'));

console.log('\nإنذارُ الطلب — يُسمع · لا يسكت · ويسكت حين يُجاب');

// ── ① يُسمع ─────────────────────────────────────────────────────────────
check('عنصرا الصوت **يُعاد استعمالهما** (نغمةٌ وإنذار)',
    /let tone: HTMLAudioElement \| null = null/.test(SND)
    && /let alarm: HTMLAudioElement \| null = null/.test(SND)
    && /if \(!tone\)/.test(SND) && /if \(!alarm\)/.test(SND),
    'عنصرٌ لكلّ نغمة لا يرث إذنَ التشغيل التلقائي فيُحجب بصمت');
check('ويُفتح قفلُهما **معاً في نفس اللمسة**',
    /for \(const a of \[toneEl\(\), alarmEl\(\)\]\)/.test(SND)
    && /addEventListener\(ev, open, \{ once: true/.test(SND)
    && /'pointerdown', 'touchstart', 'keydown'/.test(SND),
    'الإذنُ لكلّ عنصرٍ على حِدة: عنصرُ إنذارٍ يُفتح لاحقاً بلا لمسةٍ يبقى محجوباً');
check('والفتحُ يُنادى فعلاً من خطّافٍ يعمل في كلّ جلسة',
    /unlockSound\(\)/.test(HOOK),
    'دالّةٌ تُعرَّف ولا تُنادى = نفسُ العيب بلا صوت');
check('ولا `new Audio` في السياق',
    !/new Audio\(/.test(CTX), 'عاد إنشاءُ عنصرٍ لكلّ نغمة');
check('🔴 ولا يُسكتها كونُ الصفحةِ مخفيّة',
    !/document\.hidden\)\s*return;/.test(SND),
    'قِيس بكروم: بعد اللمسة تنجح `play()` وهي مخفيّة و`currentTime` يتقدّم. '
    + 'ومنعُها هناك يُسكت الإنذارَ حين يكون التاجرُ في تابٍ آخر — عكسُ المطلوب');

// ── ② لا يسكت: ملفٌّ يُلفّ بذاته، لا مؤقّت ──────────────────────────────
check('🔴 والإنذارُ **ملفٌّ بـ`loop`** لا نغمةٌ كلَّ فترة',
    /const ALARM_SRC = '\/order-alarm\.mp3'/.test(SND)
    && /alarm = make\(ALARM_SRC, true\)/.test(SND),
    'بلاغُ ناصر: «لا تُعاد وتسكت على طول». ومؤقّتٌ كلَّ فترةٍ يُبطّئه التابُ الخلفيّ');
check('ونغمةُ الحدث الواحد **بلا** `loop`',
    /tone = make\(TONE_SRC, false\)/.test(SND),
    'لو لُفّت نغمةُ الإشعار لصار كلُّ إشعارٍ إنذاراً لا يسكت');
// 🪤 والقوسُ لازمٌ في النمط: `ReturnType<typeof setInterval>` تعليقُ نوعٍ لا
//    نداء، فعدُّها جعل الفحصَ يتّهم كوداً سليماً في أوّل تشغيل.
check('ولا `setInterval` في مسار الصوت — إلّا حارسَ السقف وحده',
    (SND.match(/setInterval\(/g) || []).length === 1 && /Date\.now\(\) > alarmUntil/.test(SND),
    'أيُّ مؤقّتٍ يُنتج صوتاً يُخنق في التاب الخلفيّ؛ والسقفُ يُقاس بالساعة لا بالعدّ');
check('وملفُّ الإنذار موجودٌ في المستودع ويُنسخ إلى النشرة',
    fs.existsSync(path.join(__dirname, '..', 'order-alarm.mp3'))
    && /'order-alarm\.mp3'/.test(R('scripts/copy-static.js')),
    'ملفٌّ لا يُنسخ = ٤٠٤ = إنذارٌ صامت (ويُرتدّ إلى النغمة، لكن الإيقاعَ يضيع)');

// ── ③ إنذارٌ واحدٌ للكلّ، ويسكت حين تفرغ القائمة ─────────────────────────
check('والإسكاتُ يُوفَّق **بالقائمة** لا بحدثٍ بعينه',
    /export const syncOrderAlarm/.test(SND) && /syncOrderAlarm\(waiting\)/.test(HOOK)
    && /if \(!want\.length\) \{ stopOrderAlarm\(\); return; \}/.test(SND),
    'ربطُ الإسكات بحدثٍ واحدٍ يترك الإنذارَ يرنّ إن وصل التغييرُ بمسارٍ آخر');
check('🔴 وإنذارٌ **واحد** لعشرات الطلبات',
    /if \(!a\.paused\) return;/.test(SND) && !/forEach\(k => start/.test(SND),
    'مؤقّتٌ لكلّ طلبٍ يُنتج نغماتٍ متراكبةً — تشويشٌ لا تنبيه');
check('وطلبٌ جديدٌ يُجدّد مهلةَ السقف',
    /const fresh = want\.some\(k => !alarmKeys\.includes\(k\)\)/.test(SND)
    && /if \(fresh\) alarmUntil = Date\.now\(\) \+ MAX_ALARM_MS;/.test(SND),
    'بلا تجديدٍ يُسكت السقفُ طلبات حقيقيّة');
check('وكلُّ رنينٍ يُوقَف عند الخروج',
    /stopOrderAlarm/.test(HOOK)
    && /useEffect\(\(\) => \(\) => \{ stopOrderAlarm\(\); \}, \[\]\)/.test(HOOK),
    'تبديلُ الحساب يترك إنذارَ تاجرٍ سابقٍ يرنّ');

// ── ④⑤ من يسمعه ────────────────────────────────────────────────────────
check('نغمةُ الرسالة **للوارد وحده**',
    /row\.sender_id !== user\?\.id\) playSoundOnce\(\)/.test(CTX),
    'نغمةٌ على ما كتبتَه أنت ارتدادٌ مزعج');
check('والإنذارُ **للتاجر وحده** وعلى `pending` فقط',
    /b\?\.status === 'pending' && b\?\.deal\?\.storeId === userId/.test(HOOK),
    'المشتري يعرف أنه حجز للتوّ · و`acknowledged` تعني أن التاجر انتبه');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
