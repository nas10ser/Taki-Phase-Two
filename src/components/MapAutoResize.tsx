import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * MapAutoResize — v14.63
 * ═══════════════════════════════════════════════════════════════════════════
 * ليفلت يقيس حاويته **مرّة واحدة** عند الإنشاء. فأي تغيّرٍ في الحجم بعد ذلك
 * يترك شبكة البلاطات على المقاس القديم: شريطٌ فارغ في أسفل الخريطة، ونقرةٌ
 * تقع في غير مكانها — وهو وصف «الخريطة معلّقة» تماماً.
 *
 * وقد كان هذا مقيساً في أربعة مواضع:
 *  • «حولي»: الحاوية تتحرّك ٣٥vh ⇄ ٦٥vh بانتقالٍ مدّته ٣٠٠ms، ولا إعادة قياس
 *    بعده إطلاقاً — فثلث الخريطة السفلي بلا بلاطات بعد «الخريطة فقط».
 *  • «فروع المتجر»: تُفتح داخل نافذة `position: fixed` ولا تنادي
 *    `invalidateSize` ولا مرّة واحدة.
 *  • «مناطق التوصيل»: داخل لوحة تُفتح وتُغلق.
 *  • «إضافة منتج»: النموذج يطوي ويفرد أقساماً فوق الخريطة.
 *
 * `ResizeObserver` يرى كل ذلك بلا أن نُعدّد الحالات. ومعه قياسان مؤجَّلان
 * لالتقاط الحاويات التي تُولد بارتفاع صفر ثم تكبر (نافذة تفتح بانتقال)،
 * وحدثا الدوران والعودة من الخلفية.
 */
const MapAutoResize: React.FC = () => {
    const map = useMap();

    useEffect(() => {
        let raf = 0;
        const fix = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                try { map.invalidateSize({ animate: false }); } catch { /* ربما فُكّكت الخريطة */ }
            });
        };

        fix();
        const t1 = setTimeout(fix, 150);
        const t2 = setTimeout(fix, 450);   // بعد انتقالات الارتفاع (٣٠٠ms)

        let ro: ResizeObserver | undefined;
        try {
            if (typeof ResizeObserver !== 'undefined') {
                ro = new ResizeObserver(fix);
                ro.observe(map.getContainer());
            }
        } catch { /* متصفّح قديم — المؤقّتان يغطّيان الحالة الشائعة */ }

        window.addEventListener('orientationchange', fix);
        document.addEventListener('visibilitychange', fix);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(t1); clearTimeout(t2);
            try { ro?.disconnect(); } catch { /* ignore */ }
            window.removeEventListener('orientationchange', fix);
            document.removeEventListener('visibilitychange', fix);
        };
    }, [map]);

    return null;
};

export default MapAutoResize;
