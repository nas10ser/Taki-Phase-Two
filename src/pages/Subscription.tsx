import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { paymentService } from '../services/paymentService';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { packageRepository } from '../repositories/packageRepository';
import { LocationPackage, effectivePrice } from '../data/packages';

// Gold ring that works on light AND dark themes: interior = theme card colour,
// the 2px border is the gold gradient. Selected cards get a warm glow.
const goldRing = (selected: boolean): React.CSSProperties => ({
    border: '2px solid transparent',
    borderRadius: 22,
    backgroundImage:
        'linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)',
    backgroundOrigin: 'border-box',
    backgroundClip: 'padding-box, border-box',
    boxShadow: selected ? '0 10px 30px rgba(245,158,11,0.45)' : '0 4px 16px rgba(245,158,11,0.15)',
    transform: selected ? 'translateY(-2px)' : 'none',
    transition: 'all 0.2s ease',
});

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
                await subscriptionRepository.updateSubscription(user.id, 'premium', selected.durationDays || 30);
                await supabase.from('store_profiles').update({ max_branches: selected.max }).eq('store_id', user.id);
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
            <p className="text-sm text-[var(--text-secondary)] mb-6">
                اختر الباقة المناسبة لعدد مواقعك. <b className="text-amber-600">كل الباقات شهرية</b> — ادفع شهرياً، ألغِ متى شئت، بدون أي عمولة على الحجوزات.
            </p>

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
                                className="text-right p-5 relative"
                            >
                                {isSel && (
                                    <span
                                        className="absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-black"
                                        style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}
                                    >✓</span>
                                )}
                                {isCurrent && (
                                    <span className="absolute top-3 right-3 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">باقتك الحالية</span>
                                )}
                                <div className="text-lg font-extrabold text-[var(--text-primary)] mt-3">{p.ar}</div>
                                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                    {p.max === 1 ? 'موقع واحد' : `حتى ${p.max} مواقع`}
                                </div>
                                <div className="flex items-end gap-1 mt-3">
                                    <span className="text-4xl font-black" style={{ color: '#b45309' }}>{eff.toLocaleString('ar-SA')}</span>
                                    <span className="text-[var(--text-secondary)] font-bold mb-1 text-sm">ر.س / شهرياً</span>
                                </div>
                                {p.discount > 0 && (
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className="text-xs text-[var(--text-secondary)] line-through">{p.price.toLocaleString('ar-SA')} ر.س</span>
                                        <span className="text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">خصم {p.discount}%</span>
                                    </div>
                                )}
                                <div className="mt-3 pt-3 border-t border-amber-200/60 text-[11px] text-[var(--text-secondary)] space-y-1">
                                    <div>✓ عروض وحجوزات غير محدودة</div>
                                    <div>✓ 0% عمولة على المبيعات</div>
                                    <div>✓ {p.max === 1 ? 'موقع واحد' : `تغطي حتى ${p.max} مواقع`}</div>
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
