import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

/**
 * useVatMode — وضع ضريبة القيمة المضافة للمنصة (v13.38)
 *
 * مصدر واحد لكل الواجهة: هل تاكي مسجّلة ضريبياً وتُحصّل؟ وبأي نسبة؟ وهل
 * الضريبة تُضاف فوق السعر أم مضمّنة فيه؟ كانت كل صفحة تجلب
 * `platform_settings` بنفسها — فتتفرّق القراءة وتختلف السلوكيات.
 *
 * **هذا هو المفتاح الذي «يُظهر» كل واجهات الضريبة**: لحظة ما يفعّل ناصر
 * الضريبة من مركز التحكم بعد تسجيله في الهيئة، كل شيء مبنيّ عليه يظهر
 * تلقائياً — بلا نشر ولا تعديل سطر واحد.
 */
export interface VatMode {
    /** تاكي مسجّلة وتُحصّل الضريبة فعلياً (رقم ضريبي + تفعيل) */
    enabled: boolean;
    /** الضريبة تُضاف فوق سعر الباقة (وضع ناصر المعتمد) */
    addOnTop: boolean;
    rate: number;
    vatNumber: string;
    loading: boolean;
}

const DEFAULT: VatMode = { enabled: false, addOnTop: true, rate: 15, vatNumber: '', loading: true };

// ذاكرة مشتركة بين المكوّنات — الإعداد يتغيّر نادراً جداً، فلا داعي لطلب
// شبكة من كل بطاقة تعرض شيئاً ضريبياً.
let cached: VatMode | null = null;
let inflight: Promise<VatMode> | null = null;

const fetchMode = async (): Promise<VatMode> => {
    try {
        const { data } = await supabase.from('platform_settings')
            .select('value').eq('key', 'tax_settings').maybeSingle();
        const v = (data?.value || {}) as Record<string, unknown>;
        const vatNumber = String(v.vat_number || '');
        return {
            // التفعيل وحده لا يكفي: بلا رقم ضريبي لا تُصدر فاتورة ضريبية صحيحة
            enabled: v.vat_enabled === true && !!vatNumber,
            addOnTop: v.prices_include_vat === false,
            rate: Number(v.vat_rate) || 15,
            vatNumber,
            loading: false,
        };
    } catch {
        return { ...DEFAULT, loading: false };
    }
};

export const useVatMode = (): VatMode => {
    const [mode, setMode] = useState<VatMode>(cached || DEFAULT);

    useEffect(() => {
        if (cached) { setMode(cached); return; }
        let alive = true;
        inflight = inflight || fetchMode();
        inflight.then(m => { cached = m; inflight = null; if (alive) setMode(m); });
        return () => { alive = false; };
    }, []);

    return mode;
};

/** يُستدعى بعد حفظ إعدادات الضريبة في مركز التحكم ليظهر الأثر فوراً. */
export const invalidateVatMode = (): void => { cached = null; inflight = null; };

export default useVatMode;
