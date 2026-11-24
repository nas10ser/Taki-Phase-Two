#!/usr/bin/env node
/**
 * test-alert-tone.js — الإنذارُ **يُشغَّل فعلاً** ولا يسكت حتى يُجاب (v16.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ولماذا تشغيلٌ لا `grep`**: العيبان اللذان أبلغ عنهما ناصر **لا يظهران
 *    في أيّ فحصٍ نصّيّ**:
 *    ① `new Audio(...).play()` سليمٌ قراءةً وسقوطُه سلوكُ متصفّح (الإذنُ
 *       للعنصر الذي لُمس، فعنصرٌ يُولد لحظةَ الإشعار محجوبٌ بصمت).
 *    ② ومؤقّتٌ كلَّ ١٥ ثانية «تكرارٌ» في النصّ و**سكوتٌ** في الأذن.
 *
 * فيُترجَم الملفُّ ويُنفَّذ تحت متصفّحٍ وهميّ:
 *   · `Audio` تُسجّل كم عنصراً أُنشئ، و`play()` **تُرفض** إلّا على عنصرٍ سبق
 *     أن شُغّل داخل نافذةِ تفاعل — وهذه هي السياسةُ الحقيقيّة.
 *   · والمؤقّتاتُ والساعةُ وهميّتان فيُقفز الزمنُ ساعاتٍ في ملّي ثانية.
 *
 * 🪤 ومخرَجُ الترجمة **داخل المشروع** (`node_modules/.cache-*`): حلُّ الوحدات
 *    يصعد من موضع الملفّ (درس v16.28).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-alert-tone');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nإنذارُ الطلب — يرنّ بلا توقّف، ويسكت حين يُجاب');

fs.rmSync(out, { recursive: true, force: true });
try {
    execFileSync('npx', ['tsc', 'src/services/notificationSound.ts',
        '--outDir', out, '--module', 'commonjs', '--target', 'es2017',
        '--lib', 'es2017,dom', '--skipLibCheck', '--strict'],
        { cwd: root, stdio: 'pipe' });
} catch (e) {
    console.log('  ✗ تعذّرت ترجمةُ الخدمة');
    console.log(String(e.stdout || e.stderr || e).slice(0, 2000));
    process.exit(1);
}

// ── متصفّحٌ وهميّ ────────────────────────────────────────────────────────────
let created = [], instances = [], plays = 0, rejected = 0, pauses = 0;
let inGesture = false;

/**
 * 🪤 والمدّةُ حقيقيّةٌ مقيسةٌ من الملفّين (`afinfo`): ٠٫٣٩ ث و٦٫٠١ ث. وبلا
 *    نمذجةِ **انتهاء** التشغيل لا يستطيع الاختبارُ التفريقَ بين `loop` وعدمه
 *    — فيمرّ على كودٍ يرنّ مرّةً ويسكت، وهو بلاغُ ناصر بعينه.
 */
const DUR = { '/notify.mp3': 0.392, '/order-alarm.mp3': 6.008 };

class FakeAudio {
    constructor(src) {
        created.push(src); instances.push(this); this.src = src; this.volume = 1; this.currentTime = 0;
        this.loop = false; this.paused = true; this.dataset = {}; this._blessed = false; this._ls = {};
        this.duration = DUR[src] || 1;
    }
    addEventListener(ev, fn, opts) { (this._ls[ev] = this._ls[ev] || []).push({ fn, once: !!(opts && opts.once) }); }
    fire(ev) { for (const l of (this._ls[ev] || [])) l.fn(); this._ls[ev] = (this._ls[ev] || []).filter(l => !l.once); }
    play() {
        // 🔴 السياسةُ الحقيقيّة: الإذنُ يُمنح للعنصر الذي شُغّل أثناء التفاعل.
        if (inGesture) this._blessed = true;
        if (!this._blessed) { rejected++; return Promise.reject(new Error('NotAllowedError')); }
        plays++; this.paused = false; return Promise.resolve();
    }
    pause() { pauses++; this.paused = true; }
}

const listeners = [];
global.Audio = FakeAudio;
global.window = { addEventListener: (ev, fn, opts) => listeners.push({ ev, fn, once: !!(opts && opts.once) }) };
global.document = { hidden: false };

let seq = 0, clock = 0;
const timers = [];
global.setInterval = (fn, ms) => { const t = { id: ++seq, fn, ms, next: clock + ms }; timers.push(t); return t.id; };
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i > -1) timers.splice(i, 1); };
// 🪤 والساعةُ وهميّةٌ أيضاً: السقفُ يُقاس بـ`Date.now()` لا بعدّ الدورات.
const realNow = Date.now;
global.Date.now = () => realNow() + clock;
const advance = (ms) => {
    // 🔴 ما لا يُلفّ ينتهي عند آخره فيصير `paused` — وهو ما يجعل فحصَ «يبقى
    //    يرنّ» فحصاً حقيقياً لا شكلياً.
    for (const a of instances) {
        if (!a.paused && !a.loop && ms / 1000 >= a.duration) { a.paused = true; a.fire('ended'); }
    }
    const end = clock + ms;
    for (;;) {
        const due = timers.filter(t => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        clock = due.next; due.next += due.ms; due.fn();
    }
    clock = end;
};
const touch = async (ev = 'pointerdown') => {
    inGesture = true;
    for (const l of listeners.filter(l => l.ev === ev)) l.fn();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    inGesture = false;
};
const K = (n) => Array.from({ length: n }, (_, i) => `order:${i + 1}`);
/** عنصرُ الإنذار — يُعرَف بمصدره لا بترتيبه (الترتيبُ يتغيّر بتغيّر الكود). */
const alarmOf = () => instances.find(a => a.src === '/order-alarm.mp3');

const S = require(path.join(out, 'notificationSound.js'));

(async () => {
    // ── ① قبل أيّ لمسة: كلُّ شيءٍ محجوب (عيبُ v16.02) ─────────────────────
    S.playSound(); S.syncOrderAlarm(K(1));
    await Promise.resolve();
    check('قبل أيّ تفاعلٍ: المتصفّحُ يحجب الصوت (سلوكُه لا عيبُنا)',
        plays === 0 && rejected >= 1,
        `plays=${plays} · rejected=${rejected} — لو مرّ هذا فالمحاكاةُ خاطئةٌ ولا قيمةَ لباقي الفحوص`);
    S.stopOrderAlarm();

    // ── ② لمسةٌ واحدة تفتح قفلَ **العنصرين** ──────────────────────────────
    S.unlockSound();
    check('و`unlockSound` تربط ثلاثةَ أحداثٍ بـ`once`',
        listeners.length === 3 && listeners.every(l => l.once), `ربطَ ${listeners.length}`);
    await touch();
    check('واللمسةُ تفتح القفلَ صامتةً ثمّ تُوقف', pauses >= 2,
        'إن سُمع صوتٌ عند اللمسة فهو إزعاجٌ لا فتحُ قفل');
    check('🔴 ولمسةٌ واحدةٌ تفتح قفلَ **النغمة والإنذار معاً**',
        created.length === 2 && created.includes('/notify.mp3') && created.includes('/order-alarm.mp3'),
        `أُنشئ ${created.length}: ${created.join(' · ')} — الإذنُ لكلّ عنصرٍ على حِدة، `
        + 'فعنصرُ إنذارٍ يُنشأ لاحقاً يبقى محجوباً');

    const beforeTone = plays;
    S.playSound(); await Promise.resolve();
    check('ونغمةُ الحدث الواحد **تُسمع فعلاً**', plays === beforeTone + 1,
        'هذا جوهرُ إصلاح v16.57: عنصرٌ مفتوحُ القفل يُعاد استعماله');

    // ── ③ وتُشغَّل والصفحةُ مخفيّة (مقيسٌ على كروم: 0 ⇐ 0.243 في 1.2 ث) ────
    const beforeHidden = plays;
    global.document.hidden = true;
    S.playSound(); await Promise.resolve();
    check('🔴 وتُشغَّل والصفحةُ مخفيّة (التاجرُ في تابٍ آخر — أهمُّ الحالات)',
        plays === beforeHidden + 1, 'حارسُ `document.hidden` يُسكتها حين يحتاجها التاجرُ أكثر');
    global.document.hidden = false;

    // ── ④ 🔴 الإنذارُ **ملفٌّ يُلفّ بذاته** لا مؤقّت ────────────────────────
    S.syncOrderAlarm(K(1)); await Promise.resolve();
    check('🔴 طلبٌ واحدٌ ⇒ الإنذارُ **يرنّ**', S.isAlarmRinging(),
        'بلاغُ ناصر: «لا تُعاد وتسكت على طول»');
    check('وعنصرُ الإنذار بـ`loop` ونغمةُ الحدث بلا `loop`',
        alarmOf() !== undefined && alarmOf().loop === true
        && instances.find(a => a.src === '/notify.mp3').loop === false,
        'بلا `loop` يرنّ مرّةً ويسكت؛ ولو لُفّت نغمةُ الإشعار لصار كلُّ إشعارٍ إنذاراً');

    // 🔴 الدليلُ القاطع: **بلا أيّ دورةِ مؤقّت**، يبقى يرنّ.
    const playsAtStart = plays;
    advance(5 * 60 * 1000);                       // خمسُ دقائق
    check('🔴 وبلا أيّ نداءِ تشغيلٍ جديد يبقى يرنّ خمسَ دقائق',
        S.isAlarmRinging() && plays === playsAtStart,
        `نغماتٌ جديدة=${plays - playsAtStart} — لو احتاج نداءً فهو مؤقّتٌ يخنقه التابُ الخلفيّ`);

    // ── ⑤ 🔴 عشراتُ الطلبات ⇒ إنذارٌ **واحد** ──────────────────────────────
    const before10 = plays;
    S.syncOrderAlarm(K(30)); await Promise.resolve();
    check('🔴 ثلاثون طلباً ⇒ إنذارٌ **واحد** لا ثلاثون متراكبة',
        S.isAlarmRinging() && plays === before10 && S.waitingCount() === 30,
        `نغماتٌ=${plays - before10} · منتظر=${S.waitingCount()} — التراكبُ تشويشٌ لا تنبيه`);

    // ── ⑥ ولا يُعاد من البداية مع كلّ إعادةِ تصيير ─────────────────────────
    const beforeRe = plays;
    S.syncOrderAlarm(K(30)); S.syncOrderAlarm(K(30)); await Promise.resolve();
    check('ونداءٌ مكرّرٌ بنفس القائمة لا يُعيده من أوّله',
        plays === beforeRe, `أُعيد ${plays - beforeRe} مرّة — فتُسمع قطعاً مقطوعة`);

    // ── ⑦ 🔴 والاستلامُ (أو الإلغاء) يُسكته — بأيّ مسارٍ وصل ───────────────
    S.syncOrderAlarm(K(30).slice(1));      // استُلم واحد
    check('واستلامُ طلبٍ من ثلاثين يُبقي الإنذارَ (٢٩ ما زالت تنتظر)',
        S.isAlarmRinging() && S.waitingCount() === 29, `منتظر=${S.waitingCount()}`);
    S.syncOrderAlarm([]);
    check('🔴 وفراغُ القائمة يُسكته فوراً',
        !S.isAlarmRinging() && S.waitingCount() === 0,
        'أمرُ ناصر: «إلى أن يؤكّد التاجرُ الاستلام أو تُلغى من أحد الطرفين»');

    // ── ⑧ وسقفُ الساعة شبكةَ أمانٍ لتابٍ منسيّ ─────────────────────────────
    S.syncOrderAlarm(K(1));
    check('تابٌ منسيّ: يرنّ بعد نصف ساعة', (advance(30 * 60 * 1000), S.isAlarmRinging()),
        'نصفُ ساعةٍ أقلُّ من السقف فلا يجوز أن يسكت');
    advance(40 * 60 * 1000);
    check('ويسكت بعد تجاوز السقف', !S.isAlarmRinging(),
        'تطبيقٌ مفتوحٌ على مكتبٍ لا يرنّ إلى الصباح');

    // ── ⑨ 🔴 وطلبٌ **جديد** يُجدّد المهلة فلا يُسكِت السقفُ إنذاراً حقيقياً ──
    S.syncOrderAlarm(['order:جديد']);
    check('🔴 وطلبٌ جديدٌ بعد السقف **يُبدئ الرنين** من جديد', S.isAlarmRinging(),
        'لو لم تُجدَّد المهلةُ لصار السقفُ يُسكت طلباتٍ حقيقيّة');
    advance(30 * 60 * 1000);
    check('ويبقى يرنّ بعد نصف ساعةٍ من تجديده', S.isAlarmRinging());
    S.stopOrderAlarm();

    // ── ⑩ شبكةُ أمانٍ: لو لم يصل ملفُّ الإنذار (٤٠٤) يُرتدّ إلى النغمة ويرنّ ─
    //     صمتٌ هنا أسوأ من إيقاعٍ غير مثاليّ — فالسكوتُ هو العيبُ الذي نُصلحه.
    S.syncOrderAlarm(K(1)); await Promise.resolve();
    const a = alarmOf();
    a.fire('error');
    await Promise.resolve(); await Promise.resolve();
    check('🔴 ولو غاب ملفُّ الإنذار يُرتدّ إلى نغمة الإشعار **ويبقى يرنّ**',
        a.src === '/notify.mp3' && a.loop === true && S.isAlarmRinging(),
        `src=${a.src} · loop=${a.loop} · يرنّ=${S.isAlarmRinging()} — نشرةٌ ناقصةٌ تُسكت الإنذارَ كلَّه`);
    check('ولا يُرتدّ مرّتين (حدثٌ ثانٍ لا يُغيّر شيئاً)',
        (a.fire('error'), a.src === '/notify.mp3'), 'ارتدادٌ متكرّرٌ يُعيد الرنينَ من أوّله بلا داعٍ');
    S.stopOrderAlarm();

    console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل`);
    console.log(`   (عناصرُ صوتٍ أُنشئت: ${created.length} · نداءاتُ تشغيل: ${plays} · محجوبة: ${rejected})\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
