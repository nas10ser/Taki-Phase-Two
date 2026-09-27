/**
 * InstantRefundToggle — زرُّ الردّ الفوريّ خيارُ التاجر وحده (v15.01)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرارُ ناصر: «اجعلها على حسب سياسات التاجر، واجعل الخيار متاحاً في حال أراد
 * استخدامها، ولا أريد للموقع أن يتدخّل».
 *
 * فالمنصّة لا تفرض مهلةً ولا تُلزم بردّ: تُتيح الأداة، ومن أرادها استعملها،
 * ومن لم يُردها أطفأها — ويبقى طلبُ الاسترداد المعتاد (`booking_refunds`)
 * قائماً في الحالتين، فلا يُترك المشتري بلا طريق.
 *
 * 🪤 ومكانُه هنا لا في «الإعدادات»: القرارُ يُتّخذ وعينُ التاجر على سياسته
 *    المكتوبة فوقه مباشرةً — فالسياسةُ والأداة شيءٌ واحد، وفصلُهما يجعل
 *    أحدهما يناقض الآخر بلا أن ينتبه.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { logger } from '../../utils/logger';

export const InstantRefundToggle: React.FC = () => {
    const { user, language, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [on, setOn] = useState<boolean | null>(null);   // null = لم يصل بعد
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        const { data, error } = await supabase
            .from('store_profiles').select('instant_refund')
            .eq('store_id', user.id).maybeSingle();
        if (error) { logger.warn('instant_refund read:', error.message); return; }
        // 🪤 لا صفَّ بعد = الافتراض مفتوح (كما في القاعدة `DEFAULT true`) —
        //    ولا يُعرض مفتاحٌ بقيمةٍ مخمَّنة قبل وصول الحقيقية.
        setOn(data ? data.instant_refund !== false : true);
    }, [user?.id]);

    useEffect(() => { load(); }, [load]);

    const toggle = async () => {
        if (on === null || busy) return;
        const next = !on;
        if (!next) {
            const ok = await customConfirm(t(
                '⚠️ إطفاء الردّ الفوريّ\n\n'
                + 'لن يظهر لك زرّ «ردّ المبلغ» على الطلبات المدفوعة إلكترونياً.\n'
                + 'ويبقى المشتري قادراً على طلب الاسترداد منك كالمعتاد، وتردّ عليه أنت.\n\n'
                + 'تُعيده متى شئت من هنا. هل تُطفئه؟',
                '⚠️ Turn off instant refunds\n\n'
                + 'The «Refund» button will no longer appear on card-paid orders.\n'
                + 'Buyers can still request a refund from you as usual, and you answer it.\n\n'
                + 'You can turn it back on here any time. Turn it off?'));
            if (!ok) return;
        }

        setBusy(true);
        const { data, error } = await supabase.rpc('merchant_set_instant_refund', { p_on: next });
        setBusy(false);

        // 🪤 كتابةٌ ترفضها RLS تعود `error=null` وصفر صفوف — فلا يُقال «حُفظ»
        //    إلا بدليلٍ من الردّ نفسه.
        if (error) { await customAlert('❌ ' + error.message); return; }
        if (!(data as any)?.ok) {
            await customAlert(t('❌ لم يُحفظ التغيير — حدّث الصفحة وحاول مجدداً.',
                                '❌ Not saved — refresh and try again.'));
            return;
        }
        setOn(next);
        await customAlert(next
            ? t('✅ صار زرّ الردّ الفوريّ ظاهراً على طلباتك المدفوعة.',
                '✅ The instant-refund button is now shown on your paid orders.')
            : t('✅ أُطفئ الردّ الفوريّ. ويبقى طلبُ الاسترداد المعتاد عاملاً.',
                '✅ Instant refunds are off. The usual refund request still works.'));
    };

    if (!user?.id || on === null) return null;

    return (
        <div style={{
            marginTop: 14, padding: 14, borderRadius: 14,
            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
        }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                ↩️ {t('ردُّ المبلغ بضغطة', 'One-tap refund')}
            </div>
            <div style={{ fontSize: '0.75rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('يظهر لك زرٌّ على الطلب المدفوع بالبطاقة يردّ المبلغ للمشتري فوراً عبر بوّابتك أنت. ',
                   'A button appears on card-paid orders that returns the amount to the buyer instantly through your own gateway. ')}
                <strong style={{ color: 'var(--text-primary)' }}>
                    {t('والقرارُ قرارُك وسياستُك المكتوبة أعلاه هي المرجع',
                       'The decision is yours, and your policy above is the reference')}
                </strong>
                {t(' — تاكي لا تفرض مدّةً ولا تُلزمك بردّ.',
                   ' — TAKI sets no time limit and cannot compel a refund.')}
            </div>

            <button
                type="button" onClick={toggle} disabled={busy}
                aria-pressed={on}
                style={{
                    width: '100%', padding: 12, borderRadius: 12, cursor: busy ? 'default' : 'pointer',
                    border: `1px solid ${on ? 'var(--primary)' : 'var(--border-color)'}`,
                    background: on ? 'var(--primary)' : 'var(--card-bg)',
                    color: on ? '#fff' : 'var(--text-primary)',
                    fontWeight: 900, fontSize: '0.8rem',
                }}
            >
                {busy ? t('جارٍ…', 'Saving…')
                    : on ? t('✅ مُفعَّل — اضغط لإطفائه', '✅ On — tap to turn off')
                         : t('⚪️ مُطفأ — اضغط لتفعيله', '⚪️ Off — tap to turn on')}
            </button>
        </div>
    );
};

export default InstantRefundToggle;
