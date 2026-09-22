import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
    analyticsAllowed, setAnalyticsAllowed, CONSENT_EVENT,
} from '../services/analyticsConsent';

/**
 * AnalyticsToggleRow — مفتاح إيقاف القياس السلوكي (v14.82)
 * ═══════════════════════════════════════════════════════════════════════════
 * يظهر في موضعين بحالةٍ **واحدة**:
 *   • «حسابي ← الخصوصية» — لمن له حساب.
 *   • داخل صفحة سياسة الخصوصية (القسم ٩) — **لأن الزائر مُتتبَّعٌ أيضاً**
 *     ويُحجب عن «حسابي»، فمفتاحٌ هناك وحده يترك أكثر المتتبَّعين بلا مخرج.
 *
 * 🪤 والموضعان يستمعان لحدثٍ واحد (`CONSENT_EVENT`) فلا يعرض أحدهما حالةً
 *    قديمة بعد تبديلٍ من الآخر — مفتاحان يتناقضان أسوأ من مفتاحٍ واحد.
 */
const AnalyticsToggleRow: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [on, setOn] = useState<boolean>(() => analyticsAllowed());
    const [busy, setBusy] = useState(false);

    // يتبع أي تبديلٍ جرى من النسخة الأخرى من هذا المفتاح.
    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent).detail;
            if (d && typeof d.allowed === 'boolean') setOn(d.allowed);
        };
        window.addEventListener(CONSENT_EVENT, h);
        return () => window.removeEventListener(CONSENT_EVENT, h);
    }, []);

    const toggle = useCallback(async () => {
        setBusy(true);
        const next = !on;
        setOn(next);                       // الحالة المحلية تسري فوراً
        const synced = await setAnalyticsAllowed(next);
        setBusy(false);
        if (!synced) {
            // 🪤 لا نُرجع المفتاح: الإيقاف **سرى فعلاً على هذا الجهاز** ولو
            //    تعذّرت المزامنة. إرجاعُه كان سيوحي بأن الطلب رُفض وهو نُفِّذ.
            await customAlert(isRTL
                ? '✔️ سرى على هذا الجهاز. لكن تعذّر حفظه على حسابك (شبكة) — قد لا ينتقل لأجهزتك الأخرى.'
                : '✔️ Applied on this device. Saving it to your account failed (network) — it may not carry to your other devices.');
        }
    }, [on, isRTL, customAlert]);

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: compact ? '11px 13px' : '13px 15px',
            borderRadius: 16, background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        }}>
            <span style={{ fontSize: '1.2rem' }}>{on ? '📊' : '🚫'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                    {isRTL ? 'قياس الاستخدام' : 'Usage analytics'}
                </div>
                <div style={{
                    fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-secondary)',
                    marginTop: 3, lineHeight: 1.6,
                }}>
                    {on
                        ? (isRTL
                            ? 'مفعّل — نقيس الصفحات والنقرات بلا اسمك ولا بريدك ولا رقمك، لنعرف ما يفيد المتاجر. أوقفه متى شئت.'
                            : 'On — we measure pages and taps without your name, email or phone, to learn what helps stores. Turn it off any time.')
                        : (isRTL
                            ? 'موقوف — لا يُرسَل أي حدث من هذا الجهاز. (طلبك، وإشعاراتك، وما يلزم لتشغيل الخدمة يبقى كما هو.)'
                            : 'Off — no events are sent from this device. (Your order, alerts and what the service needs still work.)')}
                </div>
            </div>
            <button
                onClick={toggle}
                disabled={busy}
                aria-pressed={on}
                aria-label={isRTL ? 'قياس الاستخدام' : 'Usage analytics'}
                style={{
                    padding: '8px 16px', borderRadius: 999, border: 'none', whiteSpace: 'nowrap',
                    background: on ? 'var(--gray-100)' : 'linear-gradient(135deg,#10b981,#059669)',
                    color: on ? 'var(--text-primary)' : '#fff',
                    fontWeight: 900, fontSize: '0.78rem', cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                }}
            >
                {busy ? '…' : on ? (isRTL ? 'إيقاف' : 'Turn off') : (isRTL ? 'تفعيل' : 'Turn on')}
            </button>
        </div>
    );
};

export default AnalyticsToggleRow;
