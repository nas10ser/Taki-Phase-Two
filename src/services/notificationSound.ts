/**
 * notificationSound — نغمةُ الإشعار، وإنذارُ الطلب الذي لا يسكت (v16.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرا ناصر:
 *   ③ «عند إرسال طلبٍ من متجر أريد نفس نغمة الإشعار، ولكن تتكرّر إلى أن
 *      يُستلم الطلب من التاجر أو يُلغى من أحد الطرفين».
 *   ④ «وعند وصول الرسائل يظهر صوتُ النغمة، لا عند الإشعارات فقط».
 *
 * وبعد تجربة v16.58: «النغمةُ لا تُعاد وتسكت على طول. أريد الصوتَ **بدون
 * توقّف** إلى أن يؤكّد التاجرُ الاستلام أو تُلغى… ونغمةٌ واحدةٌ لن يفرّق بها
 * التاجرُ بينها وبين إشعار، خصوصاً مع عشرات الطلبات في نفس الوقت».
 *
 * ── ثلاثةُ قراراتٍ مقيسة ───────────────────────────────────────────────────
 * 🔴 ① **عنصرٌ واحدٌ يُعاد استعماله، لا عنصرٌ لكلّ نغمة.** إذنُ التشغيل
 *    التلقائي يُمنح **للعنصر الذي لمسه المستخدم**، فعنصرٌ يُولد لحظةَ الإشعار
 *    لا يرثه وتُرفض `play()` بصمت. قِيس بمتصفّحٍ وهميٍّ يُحاكي السياسة: بكود
 *    v16.02 ⇒ ٢٤٨ عنصراً و**نغمةٌ واحدةٌ سُمعت**؛ بعنصرٍ مفتوحٍ ⇒ ٢٤٧.
 *
 * 🔴 ② **الإنذارُ ملفٌّ يُكرَّر بذاته (`loop`)، لا `setInterval`.** كان في
 *    v16.57 مؤقّتاً كلَّ ١٥ ثانية، وذاك خطأٌ من وجهين: فجوةُ الصمت تُسمع
 *    «سكوتاً» (وهو بلاغُ ناصر حرفياً)، و**كروم يُبطّئ المؤقّتاتِ في التاب
 *    الخلفيّ** إلى نحو واحدةٍ في الدقيقة — أي يخنق الإنذارَ في اللحظة التي
 *    يكون التاجرُ فيها مشغولاً بشاشةٍ أخرى. وتشغيلُ الوسائط **لا يُبطّأ**:
 *    عنصرٌ بـ`loop` يرنّ إلى أن يُوقَف. (و`order-alarm.mp3` = نفسُ النغمة
 *    وفسحةٌ، خمسَ دوراتٍ — يبنيه `scripts/build-alarm-tone.js`.)
 *
 * 🔴 ③ **إنذارٌ واحدٌ لكلّ الطلبات المنتظرة، لا إنذارٌ لكلّ طلب.** كان لكلّ
 *    طلبٍ مؤقّتُه، فعشرةُ طلباتٍ = عشرُ نغماتٍ متراكبةٍ في نفس اللحظة: تشويشٌ
 *    لا تنبيه. فالإنذارُ حالةٌ واحدة: «هل ينتظرني شيء؟».
 *
 * 🪤 **ويُشغَّل والصفحةُ مخفيّة** — مقيسٌ على كروم ببروتوكول المطوّرين: بعد
 *    لمسةٍ موثوقةٍ واحدة و`visibilityState === 'hidden'` تُستوفى `play()` و
 *    `paused === false` و`currentTime` يتقدّم. والحارسُ الذي كتبتُه أوّلاً
 *    (`if (document.hidden) return`) كان يُسكت الإنذارَ في أهمّ الحالات.
 * 🪤 ويبقى قيدٌ لا يزول: آيفون يُوقف الصوتَ والمؤقّتاتِ إذا **خرج** المستخدمُ
 *    من التطبيق. والتنبيهُ والتطبيقُ مغلقٌ وظيفةُ **إشعار الجوّال** (v14.13).
 */

/** نغمةُ الحدث الواحد — ملفٌّ محلّيٌّ عمداً: الخارجيَّ حجبته سياسةُ الأمان (v16.02). */
const TONE_SRC = '/notify.mp3';

/** إنذارُ الطلب — نفسُ النغمة بفسحةٍ، يُلفّ بذاته. */
const ALARM_SRC = '/order-alarm.mp3';

/**
 * سقفُ الإنذار المتّصل. ناصر لم يطلب سقفاً («إلى أن يُستلم أو يُلغى»)، وهذا
 * هو السلوكُ ما دام أحدٌ أمام الشاشة — لكنّ تاباً منسيّاً على مكتبٍ لا يجوز
 * أن يرنّ إلى الصباح. ساعةٌ **تُجدَّد مع كلّ طلبٍ جديد**، فلا تُسكِت إنذاراً
 * حقيقياً أبداً. 🪤 ولا يُكتب هذا الرقمُ في أيّ نصٍّ ظاهر.
 */
const MAX_ALARM_MS = 60 * 60 * 1000;

/** كم مرّةً يُفحص السقف — وهو المؤقّتُ الوحيد، وتباطؤُه لا يُسكت شيئاً. */
const GUARD_MS = 30000;

let tone: HTMLAudioElement | null = null;
let alarm: HTMLAudioElement | null = null;
let unlocked = false;
let unlockBound = false;

const make = (src: string, loop: boolean): HTMLAudioElement | null => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    try {
        const a = new Audio(src);
        a.volume = 0.5;
        a.preload = 'auto';
        a.loop = loop;
        return a;
    } catch { return null; }
};

const toneEl = (): HTMLAudioElement | null => {
    if (!tone) tone = make(TONE_SRC, false);
    return tone;
};

const alarmEl = (): HTMLAudioElement | null => {
    if (!alarm) {
        alarm = make(ALARM_SRC, true);
        /**
         * 🪤 شبكةُ أمانٍ لو لم يصل ملفُّ الإنذار (نشرةٌ ناقصة · مخزنٌ قديم):
         *    يُرتدّ إلى نغمة الإشعار **مع `loop`** — فيصير أزيزاً أسرعَ إيقاعاً
         *    لكنه **يرنّ**، وصمتٌ هنا أسوأ من إيقاعٍ غير مثاليّ. والإذنُ لا
         *    يضيع: هو على العنصر لا على المصدر.
         */
        if (alarm) {
            alarm.addEventListener('error', () => {
                if (!alarm || alarm.dataset?.fallback === '1') return;
                try {
                    alarm.dataset.fallback = '1';
                    alarm.src = TONE_SRC;
                    alarm.loop = true;
                    if (alarmKeys.length) { const p = alarm.play(); if (p && p.catch) p.catch(() => { /* ignore */ }); }
                } catch { /* ignore */ }
            }, { once: true });
        }
    }
    return alarm;
};

/**
 * يُفتح القفلُ عند **أوّل تفاعلٍ حقيقيّ**: يُشغَّل العنصران صامتين ثمّ يُوقَفان،
 * فيمنح المتصفّحُ كلَّ واحدٍ منهما إذناً دائماً.
 * 🔴 **والعنصران معاً في نفس اللمسة**: الإذنُ لكلّ عنصرٍ على حِدة، فعنصرُ إنذارٍ
 *    يُفتح قفلُه لاحقاً (بلا لمسة) يبقى محجوباً — وهو العيبُ نفسُه مكرَّراً.
 */
export const unlockSound = (): void => {
    if (unlocked || unlockBound || typeof window === 'undefined') return;
    unlockBound = true;
    const open = () => {
        for (const a of [toneEl(), alarmEl()]) {
            if (!a) { unlocked = true; continue; }
            const v = a.volume;
            try {
                a.volume = 0;
                const p = a.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        try { a.pause(); a.currentTime = 0; } catch { /* ignore */ }
                        a.volume = v;
                        unlocked = true;
                    }).catch(() => { a.volume = v; });
                } else { unlocked = true; a.volume = v; }
            } catch { a.volume = v; }
        }
    };
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
        try { window.addEventListener(ev, open, { once: true, passive: true }); } catch { /* ignore */ }
    }
};

/** نغمةٌ واحدة — للإشعار والرسالة الواردة. */
export const playSound = (): void => {
    const a = toneEl();
    if (!a) return;
    try {
        a.currentTime = 0;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* محجوبٌ حتى أوّل تفاعل */ });
    } catch { /* ignore */ }
};

// ═══════════════════════════════════════════════════════════════════════════
// إنذارُ الطلب — حالةٌ واحدة: «هل ينتظرني طلبٌ لم أستلمه؟»
// ═══════════════════════════════════════════════════════════════════════════
let alarmKeys: string[] = [];
let alarmUntil = 0;
let guard: ReturnType<typeof setInterval> | null = null;

/** يبدأ الرنينَ المتّصل. نداءٌ ثانٍ وهو يرنّ **لا يُعيده من البداية**. */
export const startOrderAlarm = (): void => {
    const a = alarmEl();
    if (!a) return;
    if (!a.paused) return;
    try {
        a.currentTime = 0;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* محجوبٌ حتى أوّل تفاعل */ });
    } catch { /* ignore */ }
    if (!guard) {
        guard = setInterval(() => {
            if (Date.now() > alarmUntil) stopOrderAlarm();
        }, GUARD_MS);
    }
};

/** يُسكت الإنذار — عند الاستلام أو الإلغاء أو الخروج. */
export const stopOrderAlarm = (): void => {
    alarmKeys = [];
    if (guard) { clearInterval(guard); guard = null; }
    if (alarm) {
        try { alarm.pause(); alarm.currentTime = 0; } catch { /* ignore */ }
    }
};

/**
 * يُوفّق الإنذارَ مع قائمةِ الطلبات المنتظرة: يرنّ ما دام فيها شيء، ويسكت
 * حين تفرغ.
 * 🔴 وهذا هو **الضمانُ الوحيد** أنه يتوقّف: ربطُ الإسكات بحدثٍ بعينه
 *    (استلام/إلغاء) يترك الإنذارَ يرنّ إن وصل التغييرُ بمسارٍ آخر — إعادةُ
 *    جلبٍ، أو إلغاءٌ من المشتري، أو انتهاءُ مهلة. والمقارنةُ بالقائمة تُصيب
 *    كلَّ المسارات.
 * 🪤 وأيُّ طلبٍ **جديد** يُجدّد مهلةَ السقف: فلا يُسكِت السقفُ إنذاراً حقيقياً.
 */
export const syncOrderAlarm = (keys: string[]): void => {
    const want = (keys || []).filter(Boolean);
    if (!want.length) { stopOrderAlarm(); return; }
    const fresh = want.some(k => !alarmKeys.includes(k));
    alarmKeys = want;
    if (fresh) alarmUntil = Date.now() + MAX_ALARM_MS;
    if (Date.now() > alarmUntil) { stopOrderAlarm(); return; }
    startOrderAlarm();
};

/** للاختبار وحده: هل يرنّ الآن؟ */
export const isAlarmRinging = (): boolean => !!alarm && !alarm.paused;

/** للاختبار وحده: كم طلباً ينتظر؟ */
export const waitingCount = (): number => alarmKeys.length;

export default { unlockSound, playSound, startOrderAlarm, stopOrderAlarm, syncOrderAlarm };
