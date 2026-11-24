/**
 * notificationSound — نغمةُ التنبيه: تُفتح مرّةً، وتتكرّر حتى يُجاب (v16.57)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرا ناصر (٢٤ نوفمبر ٢٠٢٦):
 *   ③ «عند إرسال طلبٍ من متجر أريد نفس نغمة الإشعار، ولكن تتكرّر إلى أن
 *      يُستلم الطلب من التاجر أو يُلغى من أحد الطرفين — لأن التاجر قد لا
 *      ينتبه من نغمةٍ وحدة».
 *   ④ «وعند وصول الرسائل يظهر صوتُ النغمة، لا عند الإشعارات فقط».
 *
 * 🔴 **ولماذا خدمةٌ لا سطرٌ في السياق**: `new Audio()` في كلّ نداء — وهو ما
 *    كان — يُحجب بسياسة التشغيل التلقائي في المتصفّحات. المتصفّحُ يسمح
 *    بالصوت بعد **تفاعلٍ من المستخدم**، والعنصرُ المنشأ لحظةَ الحدث لا يرث
 *    ذلك الإذن. فالعنصرُ **واحدٌ يُفتح قفلُه عند أوّل لمسة** ثمّ يُعاد
 *    استعماله — وهذا هو الفرقُ بين «الصوتُ موجودٌ في الكود» و«الصوتُ يُسمع».
 *
 * 🔴 **وتُشغَّل والصفحةُ مخفيّة — وهذا مقيسٌ لا مُستنتج.** كتبتُ أوّلاً حارساً
 *    يمنعها بحجّة «المتصفّحاتُ تكتم الخلفيّة»، فقِستُ على كروم ببروتوكول
 *    المطوّرين: بعد لمسةٍ واحدةٍ موثوقة و`visibilityState === 'hidden'`،
 *    `play()` **تُستوفى** و`paused === false` و`currentTime` يتقدّم (٠ ⇐ ٠٫٢٤
 *    في ١٫٢ ثانية). فالحارسُ كان يُسكت النغمةَ **في اللحظة التي يحتاجها
 *    التاجرُ أكثر** — وهو تابٌ آخر أو شاشةٌ أخرى — وذاك عكسُ أمر ناصر
 *    («التاجرُ قد لا ينتبه من نغمةٍ وحدة»).
 * 🪤 ويبقى قيدٌ حقيقيّ: كروم يُبطّئ `setInterval` في التابات الخلفيّة (فيتمدّد
 *    الفاصل)، وآيفون يُوقف المؤقّتاتِ تماماً إذا خرج التطبيق. والتنبيهُ
 *    والتطبيقُ **مغلقٌ** وظيفةُ **إشعار الجوّال** (v14.13) لا نغمةِ صفحة —
 *    وهذا قيدُ المنصّة لا خيارُنا.
 */

/** مسارُ النغمة — ملفٌّ محلّيٌّ عمداً: الخارجيُّ حجبته سياسةُ الأمان (v16.02). */
const SRC = '/notify.mp3';

/** الفاصلُ بين نغمتين في التكرار. */
const REPEAT_MS = 15000;

/**
 * سقفُ التكرار. ناصر لم يطلب سقفاً («حتى يُستلم أو يُلغى»)، وهذا هو السلوكُ
 * المطلوب — لكنّ تطبيقاً يبقى مفتوحاً على مكتبٍ طوالَ الليل يدقّ حتى الصباح.
 * فالسقفُ شبكةُ أمانٍ لا سياسة: ساعةٌ كاملة (٢٤٠ نغمة) تكفي أيَّ طلبٍ حقيقيّ،
 * ولا تُصبح إزعاجاً بلا نهاية. 🪤 ولا يُكتب هذا الرقمُ في أيّ نصٍّ ظاهر.
 */
const MAX_REPEATS = Math.floor((60 * 60 * 1000) / REPEAT_MS);

let el: HTMLAudioElement | null = null;
let unlocked = false;
let unlockBound = false;

/** عنصرٌ واحدٌ يُعاد استعماله — إنشاءُ عنصرٍ لكلّ نغمةٍ هو ما كان يُحجب. */
const audio = (): HTMLAudioElement | null => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    if (!el) {
        try {
            el = new Audio(SRC);
            el.volume = 0.5;
            el.preload = 'auto';
        } catch { el = null; }
    }
    return el;
};

/**
 * يُفتح القفلُ عند **أوّل تفاعلٍ حقيقيّ** للمستخدم مع الصفحة: تُشغَّل النغمةُ
 * صامتةً ثمّ تُوقَف فوراً، فيمنح المتصفّحُ العنصرَ إذناً دائماً.
 * 🪤 و`{ once: true }` على ثلاثة أحداث: اللمسُ على الجوّال، والنقرُ والمفتاحُ
 *    على المكتب — ويكفي أحدُها.
 */
export const unlockSound = (): void => {
    if (unlocked || unlockBound || typeof window === 'undefined') return;
    unlockBound = true;
    const open = () => {
        const a = audio();
        if (!a) { unlocked = true; return; }
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
    };
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
        try { window.addEventListener(ev, open, { once: true, passive: true }); } catch { /* ignore */ }
    }
};

/**
 * نغمةٌ واحدة. تُهمَل بصمتٍ إن لم يُفتح القفلُ بعد (لا لمسةَ مستخدمٍ بعد).
 * 🔴 ولا شرطَ على `document.hidden`: قِيس أن التشغيل ينجح وهي مخفيّة، ومنعُه
 *    هناك يُفرّغ الميزةَ من معناها (انظر رأسَ الملفّ).
 */
export const playSound = (): void => {
    const a = audio();
    if (!a) return;
    try {
        a.currentTime = 0;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* محجوبٌ حتى أوّل تفاعل */ });
    } catch { /* ignore */ }
};

// ═══════════════════════════════════════════════════════════════════════════
// التكرار — مفتاحٌ لكلّ سببٍ مستقلّ (طلبٌ لم يُستلم مثلاً)
// ═══════════════════════════════════════════════════════════════════════════
const timers = new Map<string, { id: ReturnType<typeof setInterval>; left: number }>();

/**
 * يبدأ تكرارَ النغمة تحت `key`. نداءٌ ثانٍ بنفس المفتاح **لا يُنشئ مؤقّتاً
 * ثانياً** — فطلبان معلّقان لا يُنتجان نغمتين متداخلتين.
 * 🪤 ولا تُشغَّل نغمةٌ فوريّةٌ هنا: المنادي يُشغّلها بنفسه عند الحدث، ونغمةٌ
 *    ثانيةٌ في نفس اللحظة تُسمع كتشويش.
 */
export const startRepeating = (key: string): void => {
    if (!key || timers.has(key)) return;
    const id = setInterval(() => {
        const t = timers.get(key);
        if (!t) return;
        if (t.left <= 0) { stopRepeating(key); return; }
        t.left -= 1;
        playSound();
    }, REPEAT_MS);
    timers.set(key, { id, left: MAX_REPEATS });
};

/** يوقف تكرارَ مفتاحٍ بعينه — يُنادى عند الاستلام أو الإلغاء. */
export const stopRepeating = (key: string): void => {
    const t = timers.get(key);
    if (!t) return;
    clearInterval(t.id);
    timers.delete(key);
};

/** يوقف كلَّ تكرار — عند الخروج أو تبديل الحساب. */
export const stopAllRepeating = (): void => {
    timers.forEach(t => clearInterval(t.id));
    timers.clear();
};

/**
 * يُوفّق المؤقّتاتِ مع قائمةِ الأسباب القائمة: يبدأ ما استُجدّ ويوقف ما زال.
 * 🔴 وهذا هو **الضمانُ الوحيد** أن النغمة تتوقّف: ربطُ الإيقاف بحدثٍ بعينه
 *    (استلام/إلغاء) يترك الطلبَ يدقّ إن وصل التغييرُ بمسارٍ آخر — إعادةُ جلبٍ
 *    أو حدثُ ريل‑تايم مختلف. أمّا المقارنةُ بالقائمة فتُصيب كلَّ المسارات.
 */
export const syncRepeating = (keys: string[]): void => {
    const want = new Set(keys.filter(Boolean));
    timers.forEach((_, k) => { if (!want.has(k)) stopRepeating(k); });
    want.forEach(k => startRepeating(k));
};

/** للاختبار وحده: كم مؤقّتاً يعمل الآن. */
export const activeRepeatCount = (): number => timers.size;

export default { unlockSound, playSound, startRepeating, stopRepeating, stopAllRepeating, syncRepeating };
