import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { paymentService } from '../services/paymentService';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { packageRepository } from '../repositories/packageRepository';
import { LocationPackage, effectivePrice, branchesShort, branchesDetailed } from '../data/packages';
import SubscriptionStatusCard from '../components/SubscriptionStatusCard';

// Gold ring that works on light AND dark themes: interior = theme card colour,
// the 2px border is the gold gradient. Selected cards get a warm amber tint
// (layered above card-bg) + lift + glow — reads clearly in both themes.
const goldRing = (selected: boolean): React.CSSProperties => ({
    border: `${selected ? 2.5 : 2}px solid transparent`,
    borderRadius: 24,
    backgroundImage: selected
        ? 'linear-gradient(rgba(245,158,11,0.13), rgba(245,158,11,0.07)), linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)'
        : 'linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)',
    backgroundOrigin: 'border-box',
    backgroundClip: selected ? 'padding-box, padding-box, border-box' : 'padding-box, border-box',
    boxShadow: selected ? '0 14px 34px rgba(245,158,11,0.42)' : '0 4px 18px rgba(245,158,11,0.13)',
    transform: selected ? 'translateY(-3px)' : 'none',
    transition: 'all 0.2s ease',
});

// One feature row: a green check chip + adaptive text (light/dark safe).
const Feature: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-start gap-2">
        <span className="mt-[1px] w-[18px] h-[18px] rounded-full bg-emerald-500 text-white text-[11px] font-black flex items-center justify-center shrink-0">✓</span>
        <span className="text-[12.5px] leading-relaxed font-semibold text-[var(--text-secondary)]">{children}</span>
    </div>
);

const Subscription: React.FC = () => {
    const history = useHistory();
    const { user, storeProfiles, customAlert } = useApp();
    const [packages, setPackages] = useState<LocationPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isPaying, setIsPaying] = useState(false);
    const [isPaymentEnabled, setIsPaymentEnabled] = useState(true);

    const profile = storeProfiles[user?.id || ''];
    const currentMax = profile?.max_branches || 0;

    useEffect(() => {
        supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle().then(({ data }) => {
            if (data && data.value === false) setIsPaymentEnabled(false);
        });
    }, []);

    useEffect(() => {
        let alive = true;
        packageRepository.get().then((list) => {
            if (!alive) return;
            const active = list.filter((p) => p.active);
            setPackages(active);
            // Pre-select the package matching the store's current cap, else the first.
            const match = active.find((p) => p.max === currentMax);
            setSelectedId((match || active[0])?.id ?? null);
            setLoading(false);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentMax]);

    const selected = packages.find((p) => p.id === selectedId) || null;

    const handleSubscribe = async () => {
        if (!user || !selected) return;
        setIsPaying(true);
        try {
            const price = effectivePrice(selected);
            const response = await paymentService.initiateMoyasarPayment({
                amount: price,
                currency: 'SAR',
                description: `TAKI ${selected.ar} — ${selected.max} locations`,
                customerEmail: user.email || '',
                customerName: user.name || '',
            });
            if (response.success) {
                await subscriptionRepository.updateSubscription(user.id, 'premium', selected.durationDays || 30, {
                    amount: price,
                    maxBranches: selected.max,
                });
                await customAlert('✅ تم الاشتراك بنجاح! شكراً لثقتك في تاكي.');
                history.push('/seller');
            } else {
                await customAlert('❌ فشل عملية الدفع: ' + (response.error || 'خطأ غير معروف'));
            }
        } catch (err) {
            console.error(err);
            await customAlert('❌ حدث خطأ أثناء تفعيل الاشتراك.');
        } finally {
            setIsPaying(false);
        }
    };

    if (!user || user.userType !== 'seller') {
        return <div className="p-8 text-center text-red-500 font-tajawal">غير مصرح لك بالدخول لهذه الصفحة.</div>;
    }

    if (!isPaymentEnabled) {
        return (
            <div className="p-8 text-center font-tajawal animate-fade-in" dir="rtl">
                <h2 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">التطبيق حالياً مجاني بالكامل 🎉</h2>
                <p className="text-[var(--text-secondary)] mb-6">لا حاجة للاشتراك في الوقت الحالي بناءً على صلاحيات الإدارة.</p>
                <button onClick={() => history.push('/seller')} className="bg-taki-green text-white px-6 py-2 rounded-lg font-bold">العودة للوحة التحكم</button>
            </div>
        );
    }

    return (
        <div className="pb-28 pt-8 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir="rtl">
            <div className="flex justify-between items-center mb-2">
                <h1 className="text-3xl font-extrabold text-[var(--text-primary)]">باقات الاشتراك 🚀</h1>
                <button onClick={() => history.goBack()} className="text-[var(--text-secondary)] font-bold">رجوع →</button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
                اختر الباقة المناسبة لعدد فروعك (مواقعك الجغرافية المختلفة). <b className="text-amber-600">كل الباقات شهرية</b> — ادفع شهرياً، ألغِ متى شئت، <b className="text-emerald-600">بصفر عمولة</b> على الحجوزات.
            </p>

            {/* Current subscription status + cancel/resume (v11.38) */}
            <SubscriptionStatusCard />

            <h2 className="text-lg font-extrabold text-[var(--text-primary)] mb-3">
                {currentMax > 0 ? 'الترقية أو تغيير الباقة' : 'اختر باقتك'}
            </h2>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="h-44 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}
                </div>
            ) : packages.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] py-12">لا توجد باقات متاحة حالياً.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {packages.map((p) => {
                        const eff = effectivePrice(p);
                        const isSel = p.id === selectedId;
                        const isCurrent = p.max === currentMax;
                        return (
                            <button
                                key={p.id}
                                onClick={() => setSelectedId(p.id)}
                                style={goldRing(isSel)}
                                className="text-right p-5 relative flex flex-col"
                            >
                                {/* Badge row — reserves height so all cards align */}
                                <div className="flex items-start justify-between gap-2 min-h-[28px] mb-1">
                                    {isCurrent ? (
                                        <span className="text-[10px] font-extrabold bg-emerald-500 text-white px-2.5 py-1 rounded-full shadow-sm">باقتك الحالية</span>
                                    ) : <span />}
                                    {isSel ? (
                                        <span
                                            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0 shadow"
                                            style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}
                                        >✓</span>
                                    ) : <span className="w-7 h-7 rounded-full border-2 border-amber-300/50 shrink-0" />}
                                </div>

                                <div className="text-xl font-black text-[var(--text-primary)]">{p.ar}</div>
                                <div className="text-xs font-semibold text-[var(--text-secondary)] mt-1">
                                    {p.max === 1 ? 'فرع واحد فقط' : `حتى ${branchesShort(p.max, true)}`}
                                </div>

                                <div className="flex items-end gap-1.5 mt-4">
                                    <span className="text-[2.6rem] leading-none font-black" style={{ color: '#b45309' }}>{eff.toLocaleString('ar-SA')}</span>
                                    <span className="text-[var(--text-secondary)] font-bold mb-1 text-sm">ر.س / شهرياً</span>
                                </div>
                                {p.discount > 0 && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-[var(--text-secondary)] line-through">{p.price.toLocaleString('ar-SA')} ر.س</span>
                                        <span className="text-[10px] font-extrabold bg-red-500 text-white px-2 py-0.5 rounded-full">وفّر {p.discount}%</span>
                                    </div>
                                )}

                                <div className="mt-4 pt-4 border-t border-amber-300/40 space-y-2.5">
                                    <Feature>عروض وحجوزات غير محدودة</Feature>
                                    <Feature>صفر عمولة على المبيعات</Feature>
                                    <Feature>{p.max === 1 ? 'تغطية فرع واحد (موقع جغرافي واحد)' : `تغطية حتى ${branchesDetailed(p.max, true)}`}</Feature>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {selected && (
                <button
                    onClick={handleSubscribe}
                    disabled={isPaying}
                    className="w-full mt-6 text-white font-extrabold py-4 rounded-2xl shadow-lg disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg,#f59e0b 0%,#d97706 55%,#b45309 100%)' }}
                >
                    {isPaying
                        ? 'جاري التحويل لبوابة الدفع...'
                        : `اشترك في ${selected.ar} — ${effectivePrice(selected).toLocaleString('ar-SA')} ر.س/شهر`}
                    {!isPaying && <span>💳</span>}
                </button>
            )}
            <p className="text-center text-xs text-[var(--text-secondary)] mt-4">بوابة دفع آمنة وموثوقة (PayTabs / Moyasar)</p>
        </div>
    );
};

export default Subscription;
