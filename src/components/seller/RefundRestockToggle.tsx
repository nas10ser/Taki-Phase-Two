/**
 * RefundRestockToggle — هل تعود البضاعة للمخزون عند الاسترداد؟ (v15.06)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرارُ ناصر: «وفي حالة الاسترداد ترجع الكميه كذلك».
 *
 * 🔴 وما كان يحدث قبله، مقيساً على الإنتاج: استردادُ طلبٍ **مكتمل** لا يُعيد
 *    شيئاً — لا المتاح ولا المخزون الكامل — وكان الإشعار يقول للتاجر صراحةً
 *    «البضاعة خرجت فعلاً». صار الافتراضُ أن تعود.
 *
 * 🔴 وv15.09 صحّحت دوري: لم أعُد القرار، بل **الجوابَ الاحتياطيّ**.
 *    قرارُ ناصر: «يُسأل التاجر وهو يردّ» — لأن بعض التجار يترك القطعة
 *    المعيبة للمشتري هديةً **ويردّ المال**. فالجوابُ واقعةُ طلبٍ لا سياسةُ
 *    متجر: نفسُ التاجر يستعيد قطعةً اليوم ويهدي معيبةً غداً.
 *    فالسؤالُ يُطرح عند **كلّ** ردّ في شاشتَي الردّ، وهذا المفتاح لا يُستعمل
 *    إلا حين لا يُسأل أحد — كفكّ الإدارة لردٍّ عالق، أو مسارٍ آليّ لاحق.
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
                '⚠️ جعل الجواب الافتراضيّ «لا ترجع»\n\n'
                + 'ستُسأل عند كلّ ردٍّ كالمعتاد — وهذا يغيّر الجواب المستعمل حين لا يُسأل أحد فقط.\n'
                + 'وهو الصحيح لمن يبيع خدمةً، أو لا يستعيد التالف.\n\n'
                + 'أمّا الطلب الذي لم يُستلم بعد فكمّيته تعود دائماً — لأن البضاعة لم تخرج أصلاً.\n\n'
                + 'تُعيده متى شئت من هنا. هل تريد ذلك؟',
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
            ? t('✅ الجواب الافتراضيّ صار «نعم رجعت». وستُسأل عند كلّ ردٍّ كالمعتاد.',
                '✅ The default answer is now «yes». You are still asked on every refund.')
            : t('✅ الجواب الافتراضيّ صار «لا لم ترجع». وستُسأل عند كلّ ردٍّ كالمعتاد.',
                '✅ The default answer is now «no». You are still asked on every refund.'));
    };

    if (!user?.id || on === null) return null;

    return (
        <div style={{
            marginTop: 10, padding: 14, borderRadius: 14,
            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
        }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                📦 {t('الجواب الافتراضيّ عند الاسترداد', 'Default answer on refund')}
            </div>
            <div style={{ fontSize: '0.75rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('نسألك عند كلّ ردٍّ لطلبٍ مكتمل: «رجعت البضاعة إلى مخزونك؟» — لأنك قد تترك القطعة المعيبة للمشتري وتردّ المال. ',
                   'On every refund of a completed order we ask you: «did the goods come back?» — you may leave a faulty item with the buyer and still refund. ')}
                <strong style={{ color: 'var(--text-primary)' }}>
                    {t('وهذا المفتاح هو الجواب الذي يُؤخذ حين لا يُسأل أحد',
                       'This switch is the answer used when nobody is asked')}
                </strong>
                {t(' — كفكّ إدارة تاكي لردٍّ عالق. والطلبُ الذي لم يُستلم تعود كمّيته دائماً.',
                   ' — such as TAKI support unsticking a refund. An uncollected order always returns its quantity.')}
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
                    : on ? t('✅ الافتراضيّ: نعم رجعت', '✅ Default: yes, it came back')
                         : t('⚪️ الافتراضيّ: لا لم ترجع', '⚪️ Default: no, it did not')}
            </button>
        </div>
    );
};

export default RefundRestockToggle;
