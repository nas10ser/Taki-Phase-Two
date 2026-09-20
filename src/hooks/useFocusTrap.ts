import { useEffect, useRef } from 'react';

/**
 * useFocusTrap — حبس التركيز داخل نافذةٍ مشروطة · v14.64
 * ═══════════════════════════════════════════════════════════════════════════
 * ما كان قبله: **صفر حبسٍ للتركيز في التطبيق كلّه**. فمن يتصفّح بلوحة المفاتيح
 * أو بـSwitch Access يفتح ورقة الحجز أو حواراً، ثم يضغط Tab فيخرج المؤشّر من
 * النافذة إلى الصفحة **خلفها** — وهي صفحةٌ لا يراها ولا يستطيع إغلاق النافذة
 * منها. أي أن النافذة تصير مصيدة بلا مخرج.
 *
 * ما يفعله:
 *  ١) يحفظ العنصر الذي كان مركَّزاً قبل الفتح، ويُعيد التركيز إليه عند الإغلاق
 *     (فلا يقفز المؤشّر إلى أعلى الصفحة بعد كل حوار).
 *  ٢) يُركّز أول عنصرٍ قابل للتركيز داخل النافذة عند فتحها.
 *  ٣) يدوّر Tab و Shift+Tab داخلها فلا يخرجان منها.
 *
 * 🪤 القائمة تُقرأ **عند كل ضغطة** لا مرّةً عند الفتح: محتوى النافذة يتغيّر
 * (يُفتح محرّر، يظهر زرّ) فقائمةٌ محفوظة مسبقاً تصير كاذبة بعد أول تفاعل.
 */
const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', 'summary',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>): void {
    const restoreRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!active) return;
        const root = ref.current;
        restoreRef.current = (document.activeElement as HTMLElement) || null;

        const items = (): HTMLElement[] => {
            if (!root) return [];
            return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
                // عنصرٌ مخفيّ لا يُركَّز: `offsetParent` فارغة لمن `display:none`
                .filter(el => el.offsetParent !== null || el === document.activeElement);
        };

        // تركيزٌ أوّليّ بعد أن يرسم المتصفّح النافذة.
        const t = setTimeout(() => {
            const list = items();
            if (list.length && root && !root.contains(document.activeElement)) list[0].focus();
        }, 60);

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || !root) return;
            const list = items();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            const cur = document.activeElement as HTMLElement | null;
            if (!root.contains(cur)) { e.preventDefault(); first.focus(); return; }
            if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
        };

        document.addEventListener('keydown', onKey, true);
        return () => {
            clearTimeout(t);
            document.removeEventListener('keydown', onKey, true);
            try { restoreRef.current?.focus?.(); } catch { /* العنصر قد يكون أُزيل */ }
        };
    }, [active, ref]);
}

export default useFocusTrap;
