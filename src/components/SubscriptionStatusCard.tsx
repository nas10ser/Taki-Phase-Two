import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { subscriptionRepository, SubscriptionStatus } from '../repositories/subscriptionRepository';
import { packageRepository } from '../repositories/packageRepository';
import { LocationPackage, effectivePrice, packageLabel, branchesShort } from '../data/packages';
import { createT } from '../utils/helpers';

/**
 * SubscriptionStatusCard (v11.38) — a professional, world-class subscription
 * panel for the seller: current package, monthly price, start + end dates,
 * a colour-coded days-remaining counter, and the cancel / resume / upgrade
 * actions. `compact` renders a slim banner (used on the seller dashboard);
 * the full card is used on the /subscription manage page.
 */

const fmtDate = (iso: string | null, isRTL = false): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    // 🪤 `ar-SA` وحدها تُخرج التاريخ هجرياً — `-u-ca-gregory` إلزامية.
    return d.toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

interface Props {
    compact?: boolean;
    /** Bump this number to force a re-fetch (e.g. after a successful payment). */
    refreshKey?: number;
    onChanged?: () => void;
}

const SubscriptionStatusCard: React.FC<Props> = ({ compact = false, refreshKey = 0, onChanged }) => {
    const history = useHistory();
    const { user, customConfirm, customAlert, language } = useApp();
    const isRTL = language === 'ar';
    const t = createT(isRTL);
    const fd = (iso: string | null) => fmtDate(iso, isRTL);
    const nf = (n: number) => n.toLocaleString(isRTL ? 'ar-SA' : 'en-US');
    const [sub, setSub] = useState<SubscriptionStatus | null>(null);
    const [pkgs, setPkgs] = useState<LocationPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) { setLoading(false); return; }
        const [s, list] = await Promise.all([
            subscriptionRepository.getStoreSubscription(user.id),
            packageRepository.get(),
        ]);
        setSub(s);
        setPkgs(list);
        setLoading(false);
    }, [user?.id]);

    useEffect(() => { load(); }, [load, refreshKey]);

    if (!user || user.userType !== 'seller') return null;
    if (loading) {
        return <div style={{ height: compact ? 56 : 150, borderRadius: 18, background: 'var(--gray-100)' }} className="animate-pulse" />;
    }
    if (!sub) return null;

    const now = Date.now();
    const exp = sub.expiresAt ? new Date(sub.expiresAt).getTime() : null;
    const daysLeft = exp !== null ? Math.ceil((exp - now) / 86_400_000) : null;
    const expired = sub.plan === 'free' || (exp !== null && exp <= now);
    const canceled = !expired && (!!sub.canceledAt || sub.autoRenew === false);
    const isTrial = sub.plan === 'trial';

    const matched = pkgs.find(p => p.max === sub.maxBranches);
    const planName = (isRTL ? matched?.ar : (matched?.en || matched?.ar)) || packageLabel(sub.maxBranches, isRTL);
    const price = sub.amount > 0 ? sub.amount : (matched ? effectivePrice(matched) : 0);

    // Colour for the days-remaining counter / accent.
    const accent = expired ? '#ef4444'
        : (daysLeft !== null && daysLeft <= 3) ? '#ef4444'
        : (daysLeft !== null && daysLeft <= 7) ? '#f59e0b'
        : '#10b981';

    const statusText = expired ? t('منتهٍ', 'Expired')
        : canceled ? t(`سيتوقّف — فعّال حتى ${fd(sub.expiresAt)}`, `Ending — active until ${fd(sub.expiresAt)}`)
        : isTrial ? t('تجريبي', 'Trial')
        : t('نشط', 'Active');

    const goManage = () => history.push('/subscription');
    // On the manage page the packages grid is right below the card, so the
    // primary CTA scrolls to it instead of navigating to the same route.
    const scrollToPackages = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    const doCancel = async () => {
        const ok = await customConfirm(t(
            `سيتوقّف التجديد التلقائي، ويبقى اشتراكك فعّالاً حتى ${fd(sub.expiresAt)} (تستطيع التراجع في أي وقت). متابعة؟`,
            `Auto-renewal will stop, and your subscription stays active until ${fd(sub.expiresAt)} (you can undo this any time). Continue?`,
        ));
        if (!ok) return;
        setBusy(true);
        const r = await subscriptionRepository.setAutoRenew(false);
        setBusy(false);
        if (!r.success) { await customAlert('❌ ' + (r.error || t('تعذّر الإلغاء', 'Could not cancel'))); return; }
        await customAlert(t(
            `✅ تم إيقاف التجديد التلقائي. اشتراكك فعّال حتى ${fd(sub.expiresAt)}.`,
            `✅ Auto-renewal stopped. Your subscription stays active until ${fd(sub.expiresAt)}.`,
        ));
        await load();
        onChanged?.();
    };

    const doResume = async () => {
        setBusy(true);
        const r = await subscriptionRepository.setAutoRenew(true);
        setBusy(false);
        if (!r.success) { await customAlert('❌ ' + (r.error || t('تعذّر التفعيل', 'Could not resume'))); return; }
        await customAlert(t('✅ تم إعادة تفعيل التجديد التلقائي.', '✅ Auto-renewal is back on.'));
        await load();
        onChanged?.();
    };

    // ── Compact banner (seller dashboard) ──────────────────────────
    if (compact) {
        return (
            <button
                type="button"
                onClick={goManage}
                style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    margin: '12px 16px 0', width: 'calc(100% - 32px)',
                    padding: '12px 14px', borderRadius: 16, cursor: 'pointer',
                    background: 'var(--card-bg)', border: `1.5px solid ${accent}40`,
                    boxShadow: 'var(--shadow)', textAlign: isRTL ? 'right' : 'left',
                }}
            >
                <span style={{ fontSize: '1.4rem' }}>{expired ? '🔴' : canceled ? '⏸️' : '💳'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                        {planName} · <span style={{ color: accent }}>{statusText}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 2 }}>
                        {expired
                            ? t('جدّد الآن لاستعادة عروضك', 'Renew now to bring your deals back')
                            : daysLeft !== null
                                ? t(`يتبقّى ${daysLeft} يوم · ينتهي ${fd(sub.expiresAt)}`, `${daysLeft} days left · ends ${fd(sub.expiresAt)}`)
                                : t(`${nf(price)} ر.س/شهر`, `${nf(price)} SAR/month`)}
                    </div>
                </div>
                <span style={{
                    fontSize: '0.75rem', fontWeight: 900, color: 'white', background: accent,
                    padding: '6px 12px', borderRadius: 10, whiteSpace: 'nowrap',
                }}>
                    {expired ? t('تجديد', 'Renew') : t('إدارة', 'Manage')}
                </span>
            </button>
        );
    }

    // ── Full card (manage page) ────────────────────────────────────
    return (
        <div style={{
            background: 'var(--card-bg)', borderRadius: 22, padding: 18,
            border: `2px solid ${accent}55`, boxShadow: '0 8px 26px rgba(0,0,0,0.08)',
            marginBottom: 18,
        }} dir={isRTL ? 'rtl' : 'ltr'}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>{t('باقتك الحالية', 'Your current plan')}</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{planName}</div>
                </div>
                <span style={{
                    fontSize: '0.78rem', fontWeight: 900, color: 'white', background: accent,
                    padding: '6px 14px', borderRadius: 999,
                }}>{statusText}</span>
            </div>

            {/* Days remaining */}
            {!expired && daysLeft !== null && (
                <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14,
                    padding: '12px 14px', borderRadius: 14, background: `${accent}14`,
                }}>
                    <span style={{ fontSize: '2.2rem', fontWeight: 900, color: accent, lineHeight: 1 }}>{daysLeft}</span>
                    <span style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>{t('يوم متبقٍّ على الانتهاء', 'days left before it ends')}</span>
                </div>
            )}
            {expired && (
                <div style={{
                    marginBottom: 14, padding: '12px 14px', borderRadius: 14, background: '#ef444414',
                    color: '#ef4444', fontWeight: 800, fontSize: '0.9rem',
                }}>
                    {t('انتهى اشتراكك — عروضك متوقّفة عن الظهور. جدّد الآن لاستعادتها فوراً.',
                       'Your subscription has expired — your deals are hidden. Renew now to bring them back instantly.')}
                </div>
            )}

            {/* Details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <Detail label={t('السعر الشهري', 'Monthly price')} value={t(`${nf(price)} ر.س`, `${nf(price)} SAR`)} />
                <Detail
                    label={t('عدد الفروع (المواقع)', 'Locations included')}
                    value={sub.maxBranches === 1
                        ? t('فرع واحد', 'One branch')
                        : t(`حتى ${branchesShort(sub.maxBranches, true)}`, `up to ${branchesShort(sub.maxBranches, false)}`)}
                />
                <Detail label={t('تاريخ البداية', 'Start date')} value={fd(sub.startedAt)} />
                <Detail label={t('تاريخ الانتهاء', 'End date')} value={fd(sub.expiresAt)} />
                <Detail
                    label={t('التجديد التلقائي', 'Auto-renewal')}
                    value={expired ? t('متوقّف', 'Off') : (canceled ? t('متوقّف', 'Off') : t('مُفعّل ✓', 'On ✓'))}
                    valueColor={!expired && !canceled ? '#10b981' : '#ef4444'}
                />
            </div>

            {/* Actions */}
            <button
                onClick={scrollToPackages}
                style={{
                    width: '100%', padding: 14, borderRadius: 14, border: 'none', cursor: 'pointer',
                    color: 'white', fontWeight: 900, fontSize: '0.95rem', marginBottom: 10,
                    background: 'linear-gradient(135deg,#f59e0b 0%,#d97706 55%,#b45309 100%)',
                }}
            >
                {expired ? t('🔄 تجديد الاشتراك الآن ↓', '🔄 Renew your subscription now ↓') : t('⬆️ ترقية / تغيير الباقة ↓', '⬆️ Upgrade / change plan ↓')}
            </button>

            {!expired && (canceled ? (
                <button
                    onClick={doResume}
                    disabled={busy}
                    style={{
                        width: '100%', padding: 12, borderRadius: 14, cursor: 'pointer',
                        border: '1.5px solid #10b981', background: 'transparent',
                        color: '#10b981', fontWeight: 900, fontSize: '0.9rem', opacity: busy ? 0.6 : 1,
                    }}
                >
                    ▶️ {t('إعادة تفعيل التجديد التلقائي', 'Turn auto-renewal back on')}
                </button>
            ) : (
                <button
                    onClick={doCancel}
                    disabled={busy}
                    style={{
                        width: '100%', padding: 12, borderRadius: 14, cursor: 'pointer',
                        border: '1.5px solid var(--border-color)', background: 'transparent',
                        color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.9rem', opacity: busy ? 0.6 : 1,
                    }}
                >
                    {t('إلغاء الاشتراك (يبقى فعّالاً حتى نهاية المدة)', 'Cancel subscription (stays active until the period ends)')}
                </button>
            ))}
        </div>
    );
};

const Detail: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
    <div style={{ background: 'var(--body-bg)', borderRadius: 12, padding: '10px 12px' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: '0.92rem', fontWeight: 900, color: valueColor || 'var(--text-primary)' }}>{value}</div>
    </div>
);

export default SubscriptionStatusCard;
