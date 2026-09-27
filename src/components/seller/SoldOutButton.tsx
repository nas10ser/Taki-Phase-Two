/**
 * SoldOutButton — «نفد» بضغطة، بلا إتلاف رقم التاجر (v15.07 · الدرجة ٠)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: مفتاحُ «نفد» يدويّ ضمن الدرجة ٠.
 *
 * 🪤 ولماذا مفتاحٌ مستقلّ لا «إيقاف» ولا كتابةُ صفر:
 *   • **«إيقاف» بابٌ ذو اتجاهٍ واحد** لأي عرضٍ تجاوز فروعُه سقفَ الباقة:
 *     `tr_enforce_location_cap` يفحص عند إعادة التفعيل فقد لا يعود العرض.
 *     ومفتاحُ «نفد» يُفتح ويُغلق مئةَ مرّة.
 *   • **وكتابةُ صفرٍ في الكمّية تُتلف رقم التاجر**: يفقد «كم عنده فعلاً»،
 *     وهو ما بُني في v15.02 كلِّه. المفتاحُ يوقف البيع ويُبقي الرقم.
 *
 * 🪤 والفرضُ في القاعدة لا هنا: `tr_reserve_booking_stock` يرفض الحجز
 *    بـP0010. مفتاحٌ تقرؤه الواجهةُ وحدها اقتراحٌ على المشتري لا مفتاح.
 */
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';

export const SoldOutButton: React.FC<{ dealId: string; soldOut?: boolean; onDone?: () => void }> =
({ dealId, soldOut, onDone }) => {
    const { language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);
    const [on, setOn] = useState(!!soldOut);
    const [busy, setBusy] = useState(false);

    const toggle = async () => {
        if (busy) return;
        setBusy(true);
        const next = !on;
        const { data, error } = await supabase.rpc('merchant_set_sold_out', {
            p_deal_id: dealId, p_on: next, p_variant_id: null, p_location_id: null,
        });
        setBusy(false);
        // 🪤 كتابةٌ ترفضها RLS تعود `error=null` — فلا يُقال «تمّ» إلا بدليل.
        if (error) { await customAlert('❌ ' + error.message); return; }
        if (!(data as any)?.ok) {
            await customAlert(t('❌ لم يُحفظ — حدّث الصفحة وحاول مجدداً.', '❌ Not saved — refresh and retry.'));
            return;
        }
        setOn(next);
        onDone?.();
        await customAlert(next
            ? t('✅ أُوقف البيع. كمّيتك محفوظة كما هي، وتُعيده بضغطة.',
                '✅ Selling stopped. Your stock number is untouched — one tap brings it back.')
            : t('✅ عاد العرض للبيع بكمّيتك كما هي.', '✅ Back on sale with your stock unchanged.'));
    };

    return (
        <button type="button" onClick={toggle} disabled={busy}
            title={t(on ? 'أعِده للبيع' : 'أوقف البيع مؤقتاً بلا مساسٍ بكمّيتك'
                   , on ? 'Put back on sale' : 'Pause selling without touching your stock')}
            style={{
                flex: 1, minWidth: 0, borderRadius: 12, padding: '8px 2px',
                fontSize: '0.75rem', fontWeight: 800, cursor: busy ? 'default' : 'pointer',
                transition: 'all 0.2s ease', opacity: busy ? 0.6 : 1,
                background: on ? 'rgba(16, 185, 129, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                color: on ? 'var(--primary)' : 'var(--text-secondary)',
                border: `1px solid ${on ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
            }}>
            {busy ? '⏳' : on ? <>🔄 {t('أعِده', 'Restore')}</> : <>🚫 {t('نفد', 'Sold out')}</>}
        </button>
    );
};

export default SoldOutButton;
