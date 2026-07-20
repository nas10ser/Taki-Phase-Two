import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { paymentService } from '../services/paymentService';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { packageRepository } from '../repositories/packageRepository';
import { LocationPackage, effectivePrice, branchesShort, branchesDetailed } from '../data/packages';
import SubscriptionStatusCard from '../components/SubscriptionStatusCard';
import { buildInvoiceHtml, openPrintWindow, invoiceIsPaid, InvoicePayment, InvoiceTaxSettings } from '../utils/invoice';

// Gold ring that works on light AND dark themes: interior = theme card colour,
// the 2px border is the gold gradient. Selected cards get a warm amber tint
// (layered above card-bg) + lift + glow — reads clearly in both themes.
const goldRing = (selected: boolean): React.CSSProperties => ({
    border: `${selected ? 2.5 : 2}px solid transparent`,
    borderRadius: 24,
    backgroundImage: selected
        ? 'linear-gradient(var(--gold-soft), var(--gold-soft)), linear-gradient(var(--card-bg), var(--card-bg)), var(--gold-grad)'
        : 'linear-gradient(var(--card-bg), var(--card-bg)), var(--gold-grad)',
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

/**
 * «🧾 فواتيري» (v12.17): فواتير اشتراكات التاجر نفسه — تُنشأ تلقائياً بعد كل
 * دفعة (تريغر يرسل إشعاراً أيضاً)، وتُطبع/تُحفظ PDF بنفس مولّد فواتير الأدمن.
 */
const MyInvoices: React.FC<{ userId: string; merchantName: string; onBlocked: () => void }> = ({ userId, merchantName, onBlocked }) => {
    const [rows, setRows] = useState<InvoicePayment[]>([]);
    const [taxSettings, setTaxSettings] = useState<InvoiceTaxSettings>({ entity_name: 'TAKI — تاكي' });

    useEffect(() => {
        let alive = true;
        supabase.from('subscription_payments').select('*')
            .eq('merchant_id', userId).order('created_at', { ascending: false }).limit(24)
            .then(({ data }) => { if (alive && data) setRows(data as unknown as InvoicePayment[]); });
        supabase.rpc('get_setting', { p_key: 'tax_settings', p_default: {} })
            .then(({ data }) => { if (alive && data && (data as any).entity_name) setTaxSettings(data as unknown as InvoiceTaxSettings); });
        return () => { alive = false; };
    }, [userId]);

    if (rows.length === 0) return null;
    return (
        <div className="mt-8 bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h2 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">🧾 فواتيري</h2>
            <p className="text-[11px] text-[var(--text-secondary)] font-bold mb-3">كل اشتراك تدفعه تصدر فاتورته تلقائياً هنا — اطبعها أو احفظها PDF.</p>
            <div className="space-y-2">
                {rows.map(p => (
                    <div key={p.id} className="flex items-center gap-2 border border-[var(--border-color)] rounded-xl px-3 py-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-extrabold text-[var(--text-primary)]">
                                {new Date(p.paid_at || p.created_at).toLocaleDateString('ar-SA')} — {(Number(p.amount) || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س
                            </div>
                            <div className="text-[10px] font-bold" style={{ color: invoiceIsPaid(p) ? '#059669' : '#b45309' }}>
                                {invoiceIsPaid(p) ? '✅ مدفوعة' : (p.status || 'معلّقة')}{p.branches_count ? ` • ${p.branches_count} مواقع` : ''}
                            </div>
                        </div>
                        <button
                            onClick={() => { if (!openPrintWindow(`فاتورة ${p.id}`, buildInvoiceHtml(p, taxSettings, merchantName))) onBlocked(); }}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-teal-50 text-teal-700 border border-teal-200 active:scale-95">
                            🖨 فاتورة
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

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
                // تسجيل الدفعة → تصدر الفاتورة ويصل الإشعار تلقائياً (تريغر v12.17). best-effort.
                try {
                    await supabase.rpc('record_subscription_payment', {
                        p_amount: price, p_days: selected.durationDays || 30,
                        p_max: selected.max, p_plan_label: selected.ar,
                    });
                } catch { /* الفاتورة لا تعطّل الاشتراك */ }
                await customAlert('✅ تم الاشتراك بنجاح! شكراً لثقتك في تاكي. 🧾 فاتورتك جاهزة أسفل هذه الصفحة.');
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
                <MyInvoices userId={user.id} merchantName={user.shop || user.name || user.id}
                    onBlocked={() => { customAlert('السماح بالنوافذ المنبثقة مطلوب لعرض الفاتورة.'); }} />
            </div>
        );
    }

    return (
        <div
            className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in"
            dir="rtl"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}
        >
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-3xl font-extrabold text-[var(--text-primary)]">باقات الاشتراك 🚀</h1>
                <button
                    onClick={() => history.goBack()}
                    className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95 transition"
                    aria-label="رجوع"
                >
                    <span aria-hidden>→</span> رجوع
                </button>
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
                                            style={{ background: 'var(--gold-grad)' }}
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
                    style={{ background: 'var(--gold-grad)' }}
                >
                    {isPaying
                        ? 'جاري التحويل لبوابة الدفع...'
                        : `اشترك في ${selected.ar} — ${effectivePrice(selected).toLocaleString('ar-SA')} ر.س/شهر`}
                    {!isPaying && <span>💳</span>}
                </button>
            )}
            <p className="text-center text-xs text-[var(--text-secondary)] mt-4">بوابة دفع آمنة وموثوقة (PayTabs / Moyasar)</p>

            {/* فواتير التاجر — تصدر تلقائياً بعد كل اشتراك (v12.17) */}
            <MyInvoices userId={user.id} merchantName={user.shop || user.name || user.id}
                onBlocked={() => { customAlert('السماح بالنوافذ المنبثقة مطلوب لعرض الفاتورة.'); }} />
        </div>
    );
};

export default Subscription;
