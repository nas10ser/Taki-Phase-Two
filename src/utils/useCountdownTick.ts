import { useEffect, useState } from 'react';

/**
 * useCountdownTick — نبضة ثانية **واحدة** لكل التطبيق (v13.61)
 *
 * المشكلة التي يحلّها (بلاغ ناصر: «وميض عند النزول والطلوع»):
 * كل بطاقة عرض كانت تُشغّل `setInterval` خاصاً بها كل ثانية، ثم تُحدّث حالتها
 * — أي إعادة رسم للبطاقة **كاملة** (بما فيها عنصر الصورة). بعشرين بطاقة على
 * الشاشة تصير عشرين إعادة رسم في الثانية، كلٌّ في لحظة مختلفة (حسب ترتيب
 * التركيب)، فينشغل الخيط الرئيسي باستمرار أثناء التمرير وتسقط إطارات —
 * وهذا ما يراه المستخدم «وميضاً».
 *
 * الحل هو ما تفعله التطبيقات الكبيرة: مؤقّت واحد مشترك يوقظ المشتركين جميعاً
 * في **نفس الإطار**، مرة واحدة في الثانية، ولا يُحدَّث إلا نصّ العدّاد نفسه.
 * والمؤقّت يتوقّف تماماً حين تختفي الصفحة ويُستأنف فور عودتها (iOS يجمّد
 * المؤقّتات في الخلفية أصلاً، فنعيد المزامنة فوراً عند العودة).
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let bound = false;

const fire = () => { listeners.forEach(l => l()); };

const start = () => {
    if (timer !== null || listeners.size === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    timer = setInterval(fire, 1000);
};

const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
};

const onVisibility = () => {
    if (document.visibilityState === 'visible') { fire(); start(); }
    else stop();
};

const subscribe = (l: Listener): (() => void) => {
    listeners.add(l);
    if (!bound && typeof document !== 'undefined') {
        bound = true;
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pageshow', onVisibility);
    }
    start();
    return () => {
        listeners.delete(l);
        if (listeners.size === 0) stop();
    };
};

/** يرجع رقماً يتقدّم كل ثانية — لا تستخدمه إلا في أصغر مكوّن ممكن. */
export function useCountdownTick(): number {
    const [tick, setTick] = useState(0);
    useEffect(() => subscribe(() => setTick(t => t + 1)), []);
    return tick;
}
