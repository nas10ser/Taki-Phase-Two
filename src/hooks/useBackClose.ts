/**
 * useBackClose — زرُّ الرجوع في الجهاز يُغلق الطبقةَ المفتوحة (v15.51)
 * ═══════════════════════════════════════════════════════════════════════════
 * شكوى ناصر: «نقرتُ الرجوع فلم يعُد، فاضطررتُ للخروج من التطبيق والرجوع له».
 * وقِيس أن `src/` كلَّه فيه **صفرُ `popstate` وصفرُ `pushState`** ⇒ زرُّ الرجوع
 * لا يُغلق أيَّ طبقةٍ إطلاقاً. وداخل PWA مثبَّت لا شريطَ عنوان ولا مخرجَ آخر،
 * فالطبقةُ تبدو كأنها علّقت التطبيق.
 *
 * العقد: Esc على الحاسوب = زرُّ الرجوع على الجوّال. يُستعمل حيث `useEscClose`.
 *
 * 🪤 ولا يُترك إدخالُ التاريخ خلفه: إن أُغلقت الطبقةُ بزرٍّ في الشاشة، يُسحب
 *    الإدخالُ بـ`back()` — وإلّا احتاج المستخدمُ ضغطتين للخروج من الصفحة.
 * 🪤 ويُحرس التكرار: طبقتان فوق بعضهما تدفعان إدخالين، وكلٌّ تسحب إدخالَها هي.
 */
import { useEffect, useRef } from 'react';

export function useBackClose(active: boolean, onClose: () => void): void {
    const cb = useRef(onClose);
    cb.current = onClose;

    useEffect(() => {
        if (!active) return;
        let closedByBack = false;
        let pushed = false;
        try {
            window.history.pushState({ takiOverlay: true }, '');
            pushed = true;
        } catch { /* متصفّحٌ يمنع المكدّس — تبقى الطبقةُ بلا هذا المخرج */ }

        const onPop = () => { closedByBack = true; cb.current(); };
        window.addEventListener('popstate', onPop);
        return () => {
            window.removeEventListener('popstate', onPop);
            // أُغلقت بزرٍّ في الشاشة ⇒ إدخالُنا ما زال على المكدّس فيُسحب.
            if (pushed && !closedByBack) {
                try { window.history.back(); } catch { /* لا شيء */ }
            }
        };
    }, [active]);
}

export default useBackClose;
