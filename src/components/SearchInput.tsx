import React, { useEffect, useRef, useState } from 'react';

/**
 * SearchInput — حقل بحث لا يجمّد الكتابة (v13.34)
 *
 * المشكلة (بلاغ ناصر: «عند الكتابة في البحث يعلق»): الحقل كان مربوطاً مباشرة
 * بحالة الصفحة الأم، فكل حرف يعيد رسم الصفحة الرئيسية كاملة — البنر الدوّار
 * والأشرطة الأربعة وشبكة البطاقات — قبل أن يظهر الحرف نفسه في الحقل. على
 * الجوالات المتوسطة هذا يظهر كتعليق في الكتابة.
 *
 * الحل: الحقل يملك حالته المحلية (يستجيب للحرف فوراً — رسم الحقل وحده)،
 * ويبلّغ الصفحة الأم بعد سكوت قصير (١٨٠ms) أو فوراً عند المسح. البحث الشبكي
 * أصلاً مؤجَّل ٣٢٠ms داخل useDealBrowse فلا يتغير سلوكه إطلاقاً.
 */
interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    value: string;
    onChange: (q: string) => void;
    delay?: number;
}

const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, delay = 180, ...rest }) => {
    const [local, setLocal] = useState(value);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focused = useRef(false);

    // مزامنة من الأعلى (مسح خارجي مثلاً) — فقط عندما لا يكتب المستخدم
    useEffect(() => {
        if (!focused.current && value !== local) setLocal(value);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const handle = (q: string) => {
        setLocal(q);                                   // يظهر الحرف فوراً
        if (timer.current) clearTimeout(timer.current);
        if (!q.trim()) { onChange(q); return; }        // المسح يصل فوراً
        timer.current = setTimeout(() => onChange(q), delay);
    };

    return (
        <input
            type="text"
            {...rest}
            value={local}
            onChange={e => handle(e.target.value)}
            onFocus={e => { focused.current = true; rest.onFocus?.(e); }}
            onBlur={e => { focused.current = false; rest.onBlur?.(e); }}
        />
    );
};

export default SearchInput;
