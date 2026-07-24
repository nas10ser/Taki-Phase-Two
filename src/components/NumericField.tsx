import React, { useEffect, useState } from 'react';
import { normalizeArabicNumerals, sanitizeDecimalInput } from '../utils/helpers';

/**
 * v12.86 — حقل رقمي يقبل الأرقام العربية (٠-٩) والعشرية.
 *
 * لماذا لا نستخدم <input type="number">؟ لأن متصفحات كثيرة (خاصة iOS Safari)
 * ترفض الأرقام العربية-الهندية في حقل type="number" فتظهر e.target.value فارغة
 * — فيكتب التاجر «١٥» ولا يُسجَّل شيء. هذا هو سبب شكوى ناصر في خانات النسخ
 * والاختيارات الجديدة.
 *
 * الحل: حقل نصّي داخله مخزن نصّي خاص يحوّل العربية→الغربية ويسمح بنقطة عشرية
 * أثناء الكتابة («16.» تبقى كما هي)، ويُصدر رقماً (أو undefined عند الفراغ)
 * عبر onChange. integer=true يمنع الكسور (للكميات).
 */
interface NumericFieldProps {
    value: number | undefined;
    onChange: (n: number | undefined) => void;
    integer?: boolean;
    placeholder?: string;
    title?: string;
    disabled?: boolean;
    style?: React.CSSProperties;
    'aria-label'?: string;
}

const NumericField: React.FC<NumericFieldProps> = ({
    value, onChange, integer, placeholder, title, disabled, style, ...aria
}) => {
    const [buf, setBuf] = useState<string>(value == null ? '' : String(value));

    // مزامنة من الأب فقط عند اختلاف المعنى الرقمي (إعادة ضبط/تحميل عرض للتعديل)
    // — لا نمسح «16.» أثناء كتابتها لأن Number("16.")===16 يساوي القيمة المخزّنة.
    useEffect(() => {
        const bufNum = buf.trim() === '' ? undefined : Number(normalizeArabicNumerals(buf));
        if (bufNum !== value) setBuf(value == null ? '' : String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <input
            type="text"
            inputMode={integer ? 'numeric' : 'decimal'}
            value={buf}
            placeholder={placeholder}
            title={title}
            disabled={disabled}
            style={style}
            {...aria}
            onChange={e => {
                const normalized = normalizeArabicNumerals(e.target.value);
                const cleaned = integer ? normalized.replace(/[^\d]/g, '') : sanitizeDecimalInput(normalized);
                setBuf(cleaned);
                if (cleaned === '' || cleaned === '.') { onChange(undefined); return; }
                const n = Number(cleaned);
                onChange(Number.isNaN(n) ? undefined : Math.max(0, n));
            }}
        />
    );
};

export default NumericField;
