/**
 * RefundRestockToggle — هل تعود البضاعة للمخزون عند الاسترداد؟ (v15.06)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرارُ ناصر: «وفي حالة الاسترداد ترجع الكميه كذلك».
 *
 * 🔴 وما كان يحدث قبله، مقيساً على الإنتاج: استردادُ طلبٍ **مكتمل** لا يُعيد
 *    شيئاً — لا المتاح ولا المخزون الكامل — وكان الإشعار يقول للتاجر صراحةً
 *    «البضاعة خرجت فعلاً». صار الافتراضُ أن تعود.
 *
 * 🪤 ولماذا يبقى المفتاح بيد التاجر رغم أن ناصراً طلب الإعادة: لأن الاسترداد
 *    ليس دائماً إرجاعاً. خدمةٌ أُدّيت، أو سلعةٌ تلفت، أو ردٌّ جزئيّ لعيبٍ —
 *    في كلّ هذه لا يعود شيءٌ إلى الرفّ. فإعادةٌ صامتة دائماً هي مرآةُ
 *    «لا إعادة أبداً» التي أُصلحت للتوّ، لا نقيضُها.
 *    الافتراضُ يُعيد (أمرُ ناصر)، ومن لا تعود بضاعته يُطفئه مرّةً واحدة.
 *
 * 🪤 ومكانُه تحت سياسة الاسترداد المكتوبة مباشرةً: القرارُ يُتّخذ وعينُ
 *    التاجر على ما وعد به عملاءه — وهي نفسُ قاعدة `InstantRefundToggle`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { logger } from '../../utils/logger';

export const RefundRestockToggle: React.FC = () => {
    const { user, language, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [on, setOn] = useState<boolean | null>(null);   // null = لم يصل بعد
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        const { data, error } = await supabase
            .from('store_profiles').select('refund_restocks')
            .eq('store_id', user.id).maybeSingle();
        if (error) { logger.warn('refund_restocks read:', error.message); return; }
        // 🪤 لا صفَّ بعد = الافتراض «يُعيد» (كما `DEFAULT true` في القاعدة) —
        //    ولا يُعرض مفتاحٌ بقيمةٍ مخمَّنة قبل وصول الحقيقية.
        setOn(data ? data.refund_restocks !== false : true);
    }, [user?.id]);

    useEffect(() => { load(); }, [load]);

    const toggle = async () => {
        if (on === null || busy) return;
        const next = !on;
        if (!next) {
            const ok = await customConfirm(t(
                '⚠️ إيقاف إعادة الكمّية عند الاسترداد\n\n'
                + 'حين تردّ مبلغاً لطلبٍ **مكتمل**، لن تعود قطعتُه إلى مخزونك تلقائياً.\n'
                + 'وهذا هو الصحيح لمن يبيع خدمةً، أو لا يستعيد التالف.\n\n'
                + 'أمّا الطلب الذي لم يُستلم بعد فكمّيته تعود دائماً — لأن البضاعة لم تخرج أصلاً.\n\n'
                + 'تُعيده متى شئت من هنا. هل تُطفئه؟',
                '⚠️ Turn off automatic restock on refund\n\n'
                + 'When you refund a **completed** order, its unit will not return to your stock automatically.\n'
                + 'That is the right setting if you sell a service, or do not take damaged goods back.\n\n'
                + 'An order that was never collected always returns its quantity — the goods never left.\n\n'
                + 'You can turn it back on here any time. Turn it off?'));
            if (!ok) return;
        }

        setBusy(true);
        const { data, error } = await supabase.rpc('merchant_set_refund_restock', { p_on: next });
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
            ? t('✅ ستعود الكمّية إلى مخزونك تلقائياً عند كل استرداد.',
                '✅ Quantity will return to your stock automatically on every refund.')
            : t('✅ أُوقفت الإعادة التلقائية. تُعيد الكمّية يدوياً متى رجعت البضاعة.',
                '✅ Automatic restock is off. Add the quantity back yourself when goods return.'));
    };

    if (!user?.id || on === null) return null;

    return (
        <div style={{
            marginTop: 10, padding: 14, borderRadius: 14,
            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
        }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                📦 {t('ترجع الكمّية عند الاسترداد', 'Restock on refund')}
            </div>
            <div style={{ fontSize: '0.75rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('حين تردّ مبلغ طلبٍ مكتمل، تعود قطعتُه إلى مخزونك فوراً على كل المستويات — الإجمالي والنوع والفرع. ',
                   'When you refund a completed order, its unit returns to your stock at once on every level — total, variant and branch. ')}
                <strong style={{ color: 'var(--text-primary)' }}>
                    {t('أطفئه إن كنت تبيع خدمةً أو لا تستعيد التالف',
                       'Turn it off if you sell a service, or do not take damaged goods back')}
                </strong>
                {t(' — والطلبُ الذي لم يُستلم تعود كمّيته دائماً.',
                   ' — an uncollected order always returns its quantity.')}
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
                    : on ? t('✅ مُفعَّل — الكمّية تعود تلقائياً', '✅ On — stock returns automatically')
                         : t('⚪️ مُطفأ — تُعيدها يدوياً', '⚪️ Off — you add it back yourself')}
            </button>
        </div>
    );
};

export default RefundRestockToggle;
