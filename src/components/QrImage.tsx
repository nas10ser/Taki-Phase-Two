import React, { useEffect, useRef, useState } from 'react';

/**
 * QrImage — رمز QR يُولَّد **على الجهاز**، لا عبر طرفٍ ثالث. (v14.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ما كان قبله: ثلاثة مواضع تبني عنواناً إلى `api.qrserver.com` وتضع فيه
 *    **باركود الحجز نفسه** (`?data=<الباركود>`) أو رابط الإحالة. ومعنى ذلك
 *    ثلاثة أشياء مجتمعة:
 *      • كل باركود حجزٍ يُرسَل إلى خادم طرفٍ ثالث ويُسجَّل في سجلّاته.
 *      • تذكرة المشتري **تختفي** إن سقطت تلك الخدمة أو حجبتها شبكته — بلا أي
 *        رسالة تقول له لماذا.
 *      • ولا تعمل بلا إنترنت إطلاقاً، وهي أوّل ما يُفتح عند باب المتجر.
 *    والمشروع يملك المولّد محلياً أصلاً (`qrcode`) ويستعمله في فاتورة الضريبة.
 *
 * 🪤 والتوليد **مؤجَّل** (`import('qrcode')` داخل التأثير) لا ساكناً: صفحة
 *    «حجوزاتي» صفحةُ استعمالٍ يومي، وحقنُ مكتبةٍ في حزمتها ساكنةً يُبطئ أوّل
 *    فتحٍ لمن لا يفتح تذكرةً أصلاً.
 * 🪤 و`alt` ليس زينة: حين يفشل التوليد يبقى **الباركود نصّاً** تحت الصورة في
 *    مواضع الاستعمال، فلا يقف المشتري أمام الكاشير بلا شيء.
 */

export interface QrImageProps {
    /** النصّ المُرمَّز (باركود الحجز، رابط الإحالة…). */
    value: string;
    /** طول الضلع بالبكسل داخل الصورة المولَّدة (الدقة، لا مقاس العرض). */
    size?: number;
    /** هامش أبيض حول الرمز بوحدات الوحدة (المعيار ٤، ونستعمل ٢ للمساحات الضيّقة). */
    margin?: number;
    alt?: string;
    className?: string;
    style?: React.CSSProperties;
    /** يُنادى بعنوان البيانات حين يجهز — لمن يحتاج مشاركته أو تنزيله. */
    onReady?: (dataUrl: string) => void;
}

/** يحوّل عنوان بياناتٍ إلى ملفّ — بلا أي طلب شبكة. */
export const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const [head, b64] = dataUrl.split(',');
    const mime = /:(.*?);/.exec(head)?.[1] || 'image/png';
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], filename, { type: mime });
};

const QrImage: React.FC<QrImageProps> = ({
    value, size = 300, margin = 2, alt = 'QR', className, style, onReady,
}) => {
    const [src, setSrc] = useState('');
    const [failed, setFailed] = useState(false);
    // 🪤 `onReady` قد يكون دالّةً جديدة كل تصيير، فوضعُها في مصفوفة الاعتماد
    //    يُعيد التوليد بلا نهاية. تُقرأ من مرجعٍ ثابت.
    const readyRef = useRef(onReady);
    readyRef.current = onReady;

    useEffect(() => {
        let alive = true;
        if (!value) { setSrc(''); setFailed(false); return; }
        setFailed(false);
        (async () => {
            try {
                const QRCode = (await import('qrcode')).default;
                const url = await QRCode.toDataURL(String(value), {
                    errorCorrectionLevel: 'M',
                    margin,
                    width: size,
                });
                if (!alive) return;
                setSrc(url);
                readyRef.current?.(url);
            } catch (e) {
                if (!alive) return;
                console.warn('QrImage: تعذّر توليد الرمز', e);
                setFailed(true);
            }
        })();
        return () => { alive = false; };
    }, [value, size, margin]);

    if (failed || !src) {
        // مربّع محجوز بنفس المقاس فلا تقفز الصفحة، ونصٌّ صغير حين يفشل التوليد.
        return (
            <div
                className={className}
                style={{
                    display: 'grid', placeItems: 'center',
                    background: 'var(--body-bg)', borderRadius: 8,
                    color: 'var(--text-secondary)', fontSize: '0.65rem',
                    fontWeight: 700, textAlign: 'center', padding: 4,
                    ...style,
                }}
                aria-hidden={!failed}
            >
                {failed ? '⚠️' : ''}
            </div>
        );
    }

    return <img src={src} alt={alt} className={className} style={style} />;
};

export default QrImage;
