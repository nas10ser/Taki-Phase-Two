/**
 * StorePolicies — سياسة المتجر كما يراها المشتري **قبل الحجز** (v14.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * تظهر في صفحة المتجر وفي صفحة العرض فوق زرّ الحجز. وهي الوفاء بوعدٍ قائم في
 * صفحة الاسترداد منذ يوليو: «اطّلع — قبل الحجز — على سياسة الاسترداد المُعلَنة
 * في صفحة المتجر أو العرض».
 *
 * السطر الأخير ثابت لا يملك التاجر تغييره: الاسترداد والاستبدال بين التاجر
 * والمشتري، وتاكي وسيطٌ لا يبتّ فيهما. يظهر حتى للمتجر الذي لم يكتب سياسة، كي
 * لا يظنّ المشتري أن المنصّة ضامنة.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { refundRepository } from '../repositories/refundRepository';

export const StorePolicies: React.FC<{ storeId?: string | null; compact?: boolean }> = ({ storeId, compact = false }) => {
    const { language } = useApp();
    const isRTL = language === 'ar';
    const [data, setData] = useState<{ ok: boolean; refundPolicy?: string; storeTerms?: string } | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let alive = true;
        if (!storeId) { setReady(true); return; }
        refundRepository.storePolicies(storeId)
            .then(r => { if (alive) { setData(r); setReady(true); } })
            .catch(() => { if (alive) setReady(true); });
        return () => { alive = false; };
    }, [storeId]);

    if (!ready) return null;
    const failed = !data || data.ok === false;
    const policy = data?.refundPolicy?.trim();
    const terms = data?.storeTerms?.trim();

    return (
        <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: 18, padding: compact ? 14 : 18, marginBottom: 16,
            direction: isRTL ? 'rtl' : 'ltr', textAlign: isRTL ? 'right' : 'left',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: '1.1rem' }}>📜</span>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {isRTL ? 'سياسة الاسترداد والاستبدال' : 'Refund & exchange policy'}
                </h3>
            </div>

            {policy ? (
                <p style={{
                    margin: 0, fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.95,
                    color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                }}>{policy}</p>
            ) : (
                <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.9, color: 'var(--text-secondary)' }}>
                    {failed
                        ? (isRTL
                            ? 'تعذّر تحميل سياسة المتجر الآن — حدّث الصفحة، أو اسأل التاجر عبر المحادثة قبل الحجز.'
                            : 'Could not load the store policy right now — refresh, or ask the merchant in the chat before booking.')
                        : (isRTL
                            ? 'لم يُعلن هذا المتجر سياسة استرداد واستبدال. اسأله عبر المحادثة قبل الحجز.'
                            : 'This store has not published a refund policy. Ask them in the chat before booking.')}
                </p>
            )}

            {terms && (
                <>
                    <div style={{ height: 1, background: 'var(--border-color)', margin: '12px 0' }} />
                    <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                        {isRTL ? 'شروط المتجر' : 'Store terms'}
                    </div>
                    <p style={{
                        margin: 0, fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.95,
                        color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                    }}>{terms}</p>
                </>
            )}

            <div style={{
                marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border-color)',
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.85, color: 'var(--gray-400)',
            }}>
                {isRTL
                    ? 'ℹ️ الاسترداد والاستبدال بينك وبين التاجر ووفق سياسته المعلنة. تاكي وسيط حجز: لا تحتفظ بالمال، ولا تفرض سياسة، ولا تبتّ في الخلاف — لكنها تُسجّل طلبك وتُبلّغ التاجر وتُثبت ما جرى.'
                    : 'ℹ️ Refunds and exchanges are between you and the merchant under their published policy. TAKI is a booking intermediary: it never holds the money, does not impose a policy and does not adjudicate — but it records your request, notifies the merchant and documents what happened.'}
            </div>
        </div>
    );
};

export default StorePolicies;
