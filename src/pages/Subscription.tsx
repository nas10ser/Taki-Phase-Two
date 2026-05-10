import React, { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import TrialBanner from '../components/TrialBanner';
import { useApp } from '../context/AppContext';
import {
    subscriptionRepository, SubscriptionPlan, SubscriptionPayment
} from '../repositories/subscriptionRepository';
import { branchRepository, StoreBranch } from '../repositories/branchRepository';
import { paymentService } from '../services/paymentService';

const Subscription: React.FC = () => {
    const history = useHistory();
    const {
        user, language, customAlert, mySubscription, refreshSubscription,
        platformSettings
    } = useApp();
    const isRTL = language === 'ar';

    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
    const [branches, setBranches] = useState<StoreBranch[]>([]);
    const [loading, setLoading] = useState(true);
    const [paying, setPaying] = useState(false);

    useEffect(() => {
        if (!user) {
            history.replace('/register');
            return;
        }
        if (user.userType !== 'seller' && user.userType !== 'admin') {
            history.replace('/');
        }
    }, [user, history]);

    useEffect(() => {
        if (!user) return;
        let alive = true;
        const load = async () => {
            setLoading(true);
            const [p, pay, br] = await Promise.all([
                subscriptionRepository.listPlans(),
                subscriptionRepository.listMyPayments(user.id),
                branchRepository.listForMerchant(user.id)
            ]);
            if (!alive) return;
            setPlans(p);
            setPayments(pay);
            setBranches(br);
            setLoading(false);
        };
        load();
        return () => { alive = false; };
    }, [user?.id]);

    const branchCount = useMemo(() =>
        Math.max(1, branches.filter(b => b.isActive).length || mySubscription?.branchesCount || 1),
        [branches, mySubscription?.branchesCount]
    );

    const activePlan = useMemo(() => {
        if (mySubscription?.planId) return plans.find(p => p.id === mySubscription.planId);
        return plans[0];
    }, [plans, mySubscription?.planId]);

    const quotedPrice = useMemo(() => {
        if (!activePlan) return 0;
        const extra = Math.max(0, branchCount - activePlan.includedBranches);
        const base = activePlan.priceMonthly + extra * activePlan.extraBranchFee;
        const after = mySubscription?.discountPercent
            ? base * (1 - mySubscription.discountPercent / 100)
            : base;
        return Math.round(after * 100) / 100;
    }, [activePlan, branchCount, mySubscription?.discountPercent]);

    const handleSubscribe = async (plan: SubscriptionPlan) => {
        if (!user || !mySubscription) return;
        // Phase 2.2 — payment gateway visibility toggle.
        if (!platformSettings.paymentGatewayEnabled) {
            await customAlert(isRTL
                ? '🎉 المنصة في وضع الإطلاق — جميع الميزات متاحة لك مجاناً حالياً.'
                : '🎉 Platform is in launch mode — every feature is free for you right now.');
            return;
        }
        setPaying(true);
        try {
            const result = await paymentService.createCheckoutSession({
                merchantId: user.id,
                subscriptionId: mySubscription.id,
                planId: plan.id,
                amountSar: quotedPrice,
                description: isRTL ? `اشتراك ${plan.nameAr}` : `${plan.nameEn} subscription`,
                branchesCount: branchCount,
                successUrl: `${window.location.origin}/seller?subscribed=1`,
                cancelUrl: `${window.location.origin}/seller?subscribed=0`
            });
            if (result.gatewayHidden) {
                await customAlert(isRTL ? '🎉 المنصة مجانية حالياً.' : '🎉 Platform is free right now.');
            } else if (result.error) {
                await customAlert((isRTL ? '❌ خطأ من بوابة الدفع: ' : '❌ Gateway error: ') + result.error);
            } else if (result.checkoutUrl) {
                window.location.assign(result.checkoutUrl);
            }
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        } finally {
            setPaying(false);
            refreshSubscription();
        }
    };

    if (!user) return null;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--body-bg)', direction: isRTL ? 'rtl' : 'ltr', paddingBottom: 110 }}>
            <div style={{
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                color: 'white', padding: '24px 20px 28px',
                borderBottomLeftRadius: 24, borderBottomRightRadius: 24
            }}>
                <button onClick={() => history.goBack()} style={{
                    background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none',
                    padding: '6px 12px', borderRadius: 10, fontWeight: 800, cursor: 'pointer',
                    marginBottom: 14
                }}>{isRTL ? '← رجوع' : '← Back'}</button>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900 }}>
                    💎 {isRTL ? 'الاشتراك والفوترة' : 'Subscription & Billing'}
                </h1>
                <p style={{ margin: '6px 0 0', opacity: 0.85, fontSize: '0.9rem' }}>
                    {isRTL
                        ? 'اشتراك شهري ثابت بدون عمولة على الحجوزات.'
                        : 'Flat monthly subscription with zero booking commission.'}
                </p>
            </div>

            <TrialBanner subscription={mySubscription} isRTL={isRTL} showCTA={false} />

            <div style={{ padding: 16 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)', fontWeight: 700 }}>
                        {isRTL ? 'جاري التحميل…' : 'Loading…'}
                    </div>
                ) : (
                    <>
                        {/* Quote */}
                        <div style={{
                            background: 'var(--card-bg, white)', borderRadius: 18, padding: 18,
                            boxShadow: '0 6px 16px rgba(0,0,0,0.05)', marginBottom: 18
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    {isRTL ? 'الفاتورة الحالية' : 'Current invoice'}
                                </div>
                                <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>
                                    {quotedPrice.toFixed(2)} {isRTL ? 'ر.س' : 'SAR'}
                                </div>
                            </div>
                            <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {isRTL
                                    ? `الباقة الأساسية تشمل حتى ${activePlan?.includedBranches || 3} فروع. لديك حالياً ${branchCount} فرعاً.`
                                    : `Basic plan covers up to ${activePlan?.includedBranches || 3} branches. You currently have ${branchCount}.`}
                                {mySubscription?.discountPercent ? ` • ${isRTL ? 'خصم نشط' : 'Active discount'}: ${mySubscription.discountPercent}%` : ''}
                            </div>
                        </div>

                        {/* Plans */}
                        <h3 style={{ fontSize: '1rem', fontWeight: 900, margin: '4px 0 10px' }}>
                            {isRTL ? '📦 الباقات المتاحة' : '📦 Available plans'}
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                            {plans.map(plan => (
                                <PlanCard
                                    key={plan.id}
                                    plan={plan}
                                    isActive={mySubscription?.planId === plan.id}
                                    isRTL={isRTL}
                                    branchCount={branchCount}
                                    onSubscribe={() => handleSubscribe(plan)}
                                    paying={paying}
                                    paymentEnabled={platformSettings.paymentGatewayEnabled}
                                />
                            ))}
                        </div>

                        {/* Invoices */}
                        <h3 style={{ fontSize: '1rem', fontWeight: 900, margin: '6px 0 10px' }}>
                            {isRTL ? '🧾 سجل الفواتير' : '🧾 Invoice history'}
                        </h3>
                        {payments.length === 0 ? (
                            <div style={{
                                background: 'var(--card-bg, white)', borderRadius: 14, padding: 20,
                                textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700
                            }}>
                                {isRTL ? 'لا توجد فواتير بعد.' : 'No invoices yet.'}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {payments.map(p => <PaymentRow key={p.id} pay={p} isRTL={isRTL} />)}
                            </div>
                        )}
                    </>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

const PlanCard: React.FC<{
    plan: SubscriptionPlan;
    isActive: boolean;
    isRTL: boolean;
    branchCount: number;
    onSubscribe: () => void;
    paying: boolean;
    paymentEnabled: boolean;
}> = ({ plan, isActive, isRTL, branchCount, onSubscribe, paying, paymentEnabled }) => {
    const features = isRTL ? plan.featuresAr : plan.featuresEn;
    const extra = Math.max(0, branchCount - plan.includedBranches);
    const totalPrice = plan.priceMonthly + extra * plan.extraBranchFee;

    return (
        <div style={{
            background: 'var(--card-bg, white)',
            borderRadius: 18,
            padding: 20,
            border: isActive ? '2px solid #10b981' : '1.5px solid var(--border-color)',
            boxShadow: isActive ? '0 8px 22px rgba(16,185,129,0.18)' : '0 4px 12px rgba(0,0,0,0.04)',
            position: 'relative'
        }}>
            {isActive && (
                <span style={{
                    position: 'absolute', top: -10, insetInlineEnd: 14,
                    background: 'linear-gradient(135deg, #10b981, #047857)',
                    color: 'white', padding: '3px 10px', borderRadius: 999,
                    fontSize: '0.7rem', fontWeight: 900
                }}>{isRTL ? 'باقتك الحالية' : 'Your plan'}</span>
            )}
            <div style={{ fontSize: '1.1rem', fontWeight: 900, marginBottom: 4 }}>
                {isRTL ? plan.nameAr : plan.nameEn}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12 }}>
                {isRTL ? plan.descriptionAr : plan.descriptionEn}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: '1.7rem', fontWeight: 900, color: '#0f172a' }}>{plan.priceMonthly}</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {isRTL ? 'ر.س / شهرياً' : 'SAR / month'}
                </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 14 }}>
                {isRTL
                    ? `يشمل ${plan.includedBranches} فروع — كل فرع إضافي بـ ${plan.extraBranchFee} ر.س`
                    : `Includes ${plan.includedBranches} branches — each extra branch at ${plan.extraBranchFee} SAR`}
                {extra > 0 && (
                    <span style={{ display: 'block', color: '#b45309', fontWeight: 800, marginTop: 4 }}>
                        + {extra} × {plan.extraBranchFee} = {extra * plan.extraBranchFee} {isRTL ? 'ر.س لفروعك الإضافية' : 'SAR for extra branches'} → {totalPrice} {isRTL ? 'ر.س الإجمالي' : 'SAR total'}
                    </span>
                )}
            </div>

            <ul style={{ paddingInlineStart: 18, margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.8 }}>
                {features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>

            <button
                onClick={onSubscribe}
                disabled={paying}
                style={{
                    width: '100%', padding: 12, borderRadius: 12, border: 'none',
                    background: paymentEnabled ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'linear-gradient(135deg, #10b981, #047857)',
                    color: 'white', fontSize: '0.95rem', fontWeight: 900, cursor: 'pointer',
                    opacity: paying ? 0.6 : 1
                }}
            >
                {paying
                    ? (isRTL ? 'جاري التحويل للدفع…' : 'Redirecting to payment…')
                    : paymentEnabled
                        ? (isRTL ? `اشترك بـ ${totalPrice} ر.س / شهر` : `Subscribe — ${totalPrice} SAR / month`)
                        : (isRTL ? 'استمتع — وضع الإطلاق المجاني نشط 🎉' : 'Enjoy — free launch mode 🎉')}
            </button>
        </div>
    );
};

const PaymentRow: React.FC<{ pay: SubscriptionPayment; isRTL: boolean }> = ({ pay, isRTL }) => {
    const statusLabel = isRTL
        ? ({ paid: 'مدفوعة', pending: 'بانتظار التأكيد', failed: 'فشلت', refunded: 'مرتجعة', gifted: 'منحة' } as any)[pay.status] || pay.status
        : pay.status;
    const statusColor = pay.status === 'paid' || pay.status === 'gifted' ? '#10b981'
        : pay.status === 'pending' ? '#f59e0b'
        : '#ef4444';
    return (
        <div style={{
            background: 'var(--card-bg, white)', borderRadius: 14, padding: 14,
            border: '1px solid var(--border-color)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
            <div>
                <div style={{ fontWeight: 900 }}>{pay.amount.toFixed(2)} {pay.currency || 'SAR'}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {new Date(pay.createdAt).toLocaleString(isRTL ? 'ar-SA' : 'en')}
                </div>
            </div>
            <div style={{
                fontSize: '0.78rem', fontWeight: 800,
                background: `${statusColor}1a`, color: statusColor,
                padding: '4px 10px', borderRadius: 999
            }}>
                {statusLabel}
            </div>
        </div>
    );
};

export default Subscription;
