import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { paymentService } from '../services/paymentService';
import { packageRepository } from '../repositories/packageRepository';
import { LocationPackage, effectivePrice, branchesShort, branchesDetailed } from '../data/packages';
import SubscriptionStatusCard from '../components/SubscriptionStatusCard';
import { buildInvoiceHtml, openPrintWindow, invoiceIsPaid, InvoicePayment, InvoiceTaxSettings, InvoiceCustomer } from '../utils/invoice';
import { splitInclusive, vatOnTop, fmtSAR } from '../utils/vat';
import { invoiceQrForPayment } from '../utils/zatcaQr';
import { createT } from '../utils/helpers';

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
 * v13.37 — بيانات العميل الضريبية للفاتورة القياسية. Supabase builder كائن
 * thenable لا Promise حقيقي، فلا يملك .catch — نلفّه بـPromise.resolve.
 */
const fetchInvoiceCustomer = async (merchantId: string): Promise<InvoiceCustomer | null> => {
    try {
        const { data } = await supabase.rpc('invoice_customer_details', { p_merchant_id: merchantId });
        return (data as InvoiceCustomer) || null;
    } catch { return null; }
};

/**
 * «🧾 فواتيري» (v12.17): فواتير اشتراكات التاجر نفسه — تُنشأ تلقائياً بعد كل
 * دفعة (تريغر يرسل إشعاراً أيضاً)، وتُطبع/تُحفظ PDF بنفس مولّد فواتير الأدمن.
 */
const MyInvoices: React.FC<{ userId: string; merchantName: string; isRTL: boolean; onBlocked: () => void }> = ({ userId, merchantName, isRTL, onBlocked }) => {
    const t = createT(isRTL);
    const [rows, setRows] = useState<InvoicePayment[]>([]);
    const [taxSettings, setTaxSettings] = useState<InvoiceTaxSettings>({ entity_name: 'TAKI — تاكي' });

    useEffect(() => {
        let alive = true;
        supabase.from('subscription_payments').select('*')
            .eq('merchant_id', userId).order('created_at', { ascending: false }).limit(24)
            .then(({ data }) => { if (alive && data) setRows(data as unknown as InvoicePayment[]); });
        // v12.75 — قراءة مباشرة (المفتاح ضمن القائمة العامة في سياسة RLS):
        // get_setting أُغلقت عن API لأنها كانت تتجاوز RLS وتكشف أي مفتاح.
        supabase.from('platform_settings').select('value').eq('key', 'tax_settings').maybeSingle()
            .then(({ data }) => { if (alive && data?.value && (data.value as any).entity_name) setTaxSettings(data.value as unknown as InvoiceTaxSettings); });
        return () => { alive = false; };
    }, [userId]);

    if (rows.length === 0) return null;
    return (
        <div className="mt-8 bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h2 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">🧾 {t('فواتيري', 'My invoices')}</h2>
            <p className="text-xs text-[var(--text-secondary)] font-bold mb-3">
                {t('كل اشتراك تدفعه تصدر فاتورته تلقائياً هنا — اطبعها أو احفظها PDF.',
                   'Every subscription you pay for is invoiced automatically here — print it or save it as a PDF.')}
            </p>
            <div className="space-y-2">
                {rows.map(p => (
                    <div key={p.id} className="flex items-center gap-2 border border-[var(--border-color)] rounded-xl px-3 py-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-extrabold text-[var(--text-primary)]">
                                {new Date(p.paid_at || p.created_at).toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB')} — {(Number(p.amount) || 0).toLocaleString(isRTL ? 'ar-SA' : 'en-US', { maximumFractionDigits: 2 })} {t('ر.س', 'SAR')}
                            </div>
                            <div className="text-xs font-bold" style={{ color: invoiceIsPaid(p) ? '#059669' : '#b45309' }}>
                                {invoiceIsPaid(p) ? t('✅ مدفوعة', '✅ Paid') : (p.status || t('معلّقة', 'Pending'))}
                                {p.branches_count ? ` • ${p.branches_count} ${t('مواقع', 'locations')}` : ''}
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                // v13.37 — فاتورة قياسية (B2B): تُجلب بيانات العميل
                                // الضريبية كاملة، وبدونها لا يخصم ضريبة مدخلاته.
                                const [qr, cust] = await Promise.all([
                                    invoiceQrForPayment(p, taxSettings),
                                    fetchInvoiceCustomer(userId),
                                ]);
                                if (!openPrintWindow(t(`فاتورة ${p.id}`, `Invoice ${p.id}`), buildInvoiceHtml(p, taxSettings, merchantName, false, { qrDataUrl: qr, customer: cust }))) onBlocked();
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-teal-50 text-teal-700 border border-teal-200 active:scale-95">
                            🖨 {t('فاتورة', 'Invoice')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

const Subscription: React.FC = () => {
    const history = useHistory();
    const { user, storeProfiles, customAlert, language } = useApp();
    const isRTL = language === 'ar';
    const t = createT(isRTL);
    // أرقام المبالغ: أرقام عربية-هندية في الواجهة العربية، لاتينية في الإنجليزية.
    const nf = (n: number) => n.toLocaleString(isRTL ? 'ar-SA' : 'en-US');
    const pkgName = (p: LocationPackage) => (isRTL ? p.ar : (p.en || p.ar));
    const [packages, setPackages] = useState<LocationPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isPaying, setIsPaying] = useState(false);
    const [isPaymentEnabled, setIsPaymentEnabled] = useState(true);
    // v13.30 — إعدادات الضريبة (من مركز التحكم): لعرض تفصيل ضريبة القيمة
    // المضافة على سعر الباقة قبل الدفع — نفس أرقام الفاتورة والإيميل بالضبط.
    const [taxSettings, setTaxSettings] = useState<InvoiceTaxSettings | null>(null);
    useEffect(() => {
        let alive = true;
        supabase.from('platform_settings').select('value').eq('key', 'tax_settings').maybeSingle()
            .then(({ data }) => { if (alive && data?.value) setTaxSettings(data.value as unknown as InvoiceTaxSettings); });
        return () => { alive = false; };
    }, []);

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

    // v13.36 (قرار ناصر): ضريبة القيمة المضافة تُضاف فوق سعر الباقة —
    // «الاشتراكات الشهرية ضيف عليها الضريبة». سعر الكتالوج يبقى صافياً،
    // والمبلغ المُحصَّل من بوابة الدفع = الصافي + الضريبة، بينما تُسجَّل
    // الدفعة بالصافي (حساب الفاتورة/الإقرار يبني الضريبة فوقه — مصدر واحد).
    // لا تُحصَّل ضريبة إلا بعد تفعيلها من مركز التحكم (بعد التسجيل في الهيئة).
    const chargeVat = (net: number): number => {
        if (!taxSettings?.vat_enabled) return 0;
        if (taxSettings?.prices_include_vat !== false) return 0;   // شامل: لا إضافة
        return vatOnTop(net, taxSettings?.vat_rate ?? 15);
    };

    const handleSubscribe = async () => {
        if (!user || !selected) return;
        setIsPaying(true);
        try {
            const price = effectivePrice(selected);
            const vatDue = chargeVat(price);
            const response = await paymentService.initiateMoyasarPayment({
                amount: Math.round((price + vatDue) * 100) / 100,
                currency: 'SAR',
                description: `TAKI ${selected.ar} — ${selected.max} locations${vatDue > 0 ? ` (incl. ${fmtSAR(vatDue)} VAT)` : ''}`,
                customerEmail: user.email || '',
                customerName: user.name || '',
            });
            if (response.success) {
                // v13.43 (security): activation moved server-side. This used to
                // write store_profiles straight from the browser — plan, expiry,
                // price and branch cap all chosen client-side — which meant any
                // merchant could grant themselves any package free, forever,
                // straight from the console. Now we send only the package id and
                // the server reads price/duration/cap out of the catalogue in
                // platform_settings.location_packages, which only admins edit.
                const { data: applied, error: subErr } = await supabase.rpc(
                    'subscribe_self_to_package',
                    { p_package_id: selected.id },
                );
                if (subErr || !applied?.success) {
                    await customAlert(t('❌ تعذّر تفعيل الاشتراك: ', '❌ Could not activate the subscription: ')
                        + (subErr?.message || applied?.error || t('خطأ غير معروف', 'unknown error')));
                    return;
                }
                // تسجيل الدفعة → تصدر الفاتورة ويصل الإشعار تلقائياً (تريغر v12.17). best-effort.
                // الأرقام من ردّ الخادم لا من الواجهة، فتطابق الفاتورةُ ما فُعِّل فعلاً.
                try {
                    await supabase.rpc('record_subscription_payment', {
                        p_amount: applied.amount, p_days: applied.days,
                        p_max: applied.max_branches, p_plan_label: selected.ar,
                    });
                } catch { /* الفاتورة لا تعطّل الاشتراك */ }
                await customAlert(t(
                    '✅ تم الاشتراك بنجاح! شكراً لثقتك في تاكي. 🧾 فاتورتك جاهزة أسفل هذه الصفحة.',
                    '✅ Subscribed successfully! Thank you for trusting TAKI. 🧾 Your invoice is ready at the bottom of this page.',
                ));
                history.push('/seller');
            } else {
                await customAlert(t('❌ فشل عملية الدفع: ', '❌ Payment failed: ') + (response.error || t('خطأ غير معروف', 'unknown error')));
            }
        } catch (err) {
            console.error(err);
            await customAlert(t('❌ حدث خطأ أثناء تفعيل الاشتراك.', '❌ Something went wrong while activating the subscription.'));
        } finally {
            setIsPaying(false);
        }
    };

    if (!user || user.userType !== 'seller') {
        return <div className="p-8 text-center text-red-500 font-tajawal">{t('غير مصرح لك بالدخول لهذه الصفحة.', 'You are not allowed to open this page.')}</div>;
    }

    if (!isPaymentEnabled) {
        return (
            <div className="p-8 text-center font-tajawal animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
                <h2 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">{t('التطبيق حالياً مجاني بالكامل 🎉', 'The platform is completely free right now 🎉')}</h2>
                <p className="text-[var(--text-secondary)] mb-6">{t('لا حاجة للاشتراك في الوقت الحالي بناءً على صلاحيات الإدارة.', 'No subscription is needed at the moment, by the platform’s own settings.')}</p>
                <button onClick={() => history.push('/seller')} className="bg-taki-green text-white px-6 py-2 rounded-lg font-bold">{t('العودة للوحة التحكم', 'Back to dashboard')}</button>
                <MyInvoices userId={user.id} merchantName={user.shop || user.name || user.id} isRTL={isRTL}
                    onBlocked={() => { customAlert(t('السماح بالنوافذ المنبثقة مطلوب لعرض الفاتورة.', 'Pop-ups must be allowed to open the invoice.')); }} />
            </div>
        );
    }

    return (
        <div
            className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in"
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}
        >
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-3xl font-extrabold text-[var(--text-primary)]">{t('باقات الاشتراك 🚀', 'Subscription plans 🚀')}</h1>
                <button
                    onClick={() => history.goBack()}
                    className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95 transition"
                    aria-label={t('رجوع', 'Back')}
                >
                    <span aria-hidden>{isRTL ? '→' : '←'}</span> {t('رجوع', 'Back')}
                </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
                {isRTL ? (
                    <>اختر الباقة المناسبة لعدد فروعك (مواقعك الجغرافية المختلفة). <b className="text-amber-600">كل الباقات شهرية</b> — ادفع شهرياً، ألغِ متى شئت، <b className="text-emerald-600">بصفر عمولة</b> على الحجوزات.</>
                ) : (
                    <>Pick the plan that matches how many locations you cover. <b className="text-amber-600">Every plan is monthly</b> — pay monthly, cancel any time, with <b className="text-emerald-600">zero commission</b> on bookings.</>
                )}
            </p>

            {/* Current subscription status + cancel/resume (v11.38) */}
            <SubscriptionStatusCard />

            <h2 className="text-lg font-extrabold text-[var(--text-primary)] mb-3">
                {currentMax > 0 ? t('الترقية أو تغيير الباقة', 'Upgrade or change your plan') : t('اختر باقتك', 'Choose your plan')}
            </h2>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="h-44 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}
                </div>
            ) : packages.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] py-12">{t('لا توجد باقات متاحة حالياً.', 'No plans are available right now.')}</div>
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
                                className="text-start p-5 relative flex flex-col"
                            >
                                {/* Badge row — reserves height so all cards align */}
                                <div className="flex items-start justify-between gap-2 min-h-[28px] mb-1">
                                    {isCurrent ? (
                                        <span className="text-xs font-extrabold bg-emerald-500 text-white px-2.5 py-1 rounded-full shadow-sm">{t('باقتك الحالية', 'Your current plan')}</span>
                                    ) : <span />}
                                    {isSel ? (
                                        <span
                                            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0 shadow"
                                            style={{ background: 'var(--gold-grad)' }}
                                        >✓</span>
                                    ) : <span className="w-7 h-7 rounded-full border-2 border-amber-300/50 shrink-0" />}
                                </div>

                                <div className="text-xl font-black text-[var(--text-primary)]">{pkgName(p)}</div>
                                <div className="text-xs font-semibold text-[var(--text-secondary)] mt-1">
                                    {p.max === 1
                                        ? t('فرع واحد فقط', 'One location only')
                                        : t(`حتى ${branchesShort(p.max, true)}`, `up to ${branchesShort(p.max, false)}`)}
                                </div>

                                <div className="flex items-end gap-1.5 mt-4">
                                    <span className="text-[2.6rem] leading-none font-black" style={{ color: '#b45309' }}>{nf(eff)}</span>
                                    <span className="text-[var(--text-secondary)] font-bold mb-1 text-sm">{t('ر.س / شهرياً', 'SAR / month')}</span>
                                </div>
                                {p.discount > 0 && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-[var(--text-secondary)] line-through">{nf(p.price)} {t('ر.س', 'SAR')}</span>
                                        <span className="text-xs font-extrabold bg-red-500 text-white px-2 py-0.5 rounded-full">{t(`وفّر ${p.discount}%`, `Save ${p.discount}%`)}</span>
                                    </div>
                                )}

                                <div className="mt-4 pt-4 border-t border-amber-300/40 space-y-2.5">
                                    <Feature>{t('عروض وحجوزات غير محدودة', 'Unlimited deals and bookings')}</Feature>
                                    <Feature>{t('صفر عمولة على المبيعات', 'Zero commission on sales')}</Feature>
                                    <Feature>
                                        {p.max === 1
                                            ? t('تغطية فرع واحد (موقع جغرافي واحد)', 'Covers one branch (a single geographic location)')
                                            : t(`تغطية حتى ${branchesDetailed(p.max, true)}`, `Covers up to ${branchesDetailed(p.max, false)}`)}
                                    </Feature>
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
                        ? t('جاري التحويل لبوابة الدفع...', 'Redirecting to the payment gateway…')
                        : (() => {
                            // v13.36 — الزر يعرض ما سيُحصَّل فعلاً: مع ضريبة مضافة
                            // فوق السعر يظهر الإجمالي شاملاً (شفافية كاملة قبل الدفع)
                            const net = effectivePrice(selected);
                            const vatDue = chargeVat(net);
                            return vatDue > 0
                                ? t(
                                    `اشترك في ${selected.ar} — ${fmtSAR(net + vatDue)} ر.س/شهر (شامل الضريبة)`,
                                    `Subscribe to ${pkgName(selected)} — ${fmtSAR(net + vatDue)} SAR/month (VAT included)`,
                                )
                                : t(
                                    `اشترك في ${selected.ar} — ${nf(net)} ر.س/شهر`,
                                    `Subscribe to ${pkgName(selected)} — ${nf(net)} SAR/month`,
                                );
                        })()}
                    {!isPaying && <span>💳</span>}
                </button>
            )}
            {/* v13.30 — تفصيل ضريبة القيمة المضافة على سعر الباقة (طلب ناصر):
                نفس حساب الفاتورة والإيميل حرفياً — إن كانت الضريبة مفعّلة تُعرض
                القسمة (أساس + ضريبة)، وقبل التسجيل الضريبي يُوضَّح أن لا ضريبة تُحصَّل. */}
            {selected && (() => {
                const price = effectivePrice(selected);
                const on = !!taxSettings?.vat_enabled;
                const rate = taxSettings?.vat_rate ?? 15;
                const incl = taxSettings?.prices_include_vat !== false;
                if (!on) {
                    return (
                        <p className="text-center text-xs font-bold text-[var(--text-secondary)] mt-3 leading-relaxed">
                            🧾 {t(
                                `لا تُحصَّل ضريبة قيمة مضافة على الاشتراك حالياً (المنشأة قبل التسجيل الضريبي) — عند التفعيل تُضاف ${rate}٪ فوق سعر الباقة وتظهر في فاتورتك تلقائياً.`,
                                `No VAT is charged on subscriptions yet (the entity is not VAT-registered) — once it is, ${rate}% is added on top of the plan price and appears on your invoice automatically.`,
                            )}
                        </p>
                    );
                }
                if (incl) {
                    const s = splitInclusive(price, rate);
                    return (
                        <p className="text-center text-xs font-extrabold mt-3 leading-relaxed" style={{ color: '#0d9488' }}>
                            🧾 {t(
                                `السعر شامل ضريبة القيمة المضافة ${rate}٪ — الأساس ${fmtSAR(s.base)} ر.س + الضريبة ${fmtSAR(s.vat)} ر.س = ${fmtSAR(s.total)} ر.س.`,
                                `Price includes ${rate}% VAT — base ${fmtSAR(s.base)} SAR + VAT ${fmtSAR(s.vat)} SAR = ${fmtSAR(s.total)} SAR.`,
                            )}
                        </p>
                    );
                }
                // v13.36 — الوضع المعتمد: الضريبة تُضاف فوق سعر الباقة. نعرض
                // التفصيل الكامل قبل الدفع (سعر الباقة + الضريبة = المحصَّل).
                const vat = vatOnTop(price, rate);
                return (
                    <div className="text-center mt-3 leading-relaxed rounded-xl py-2 px-3 mx-auto max-w-sm" style={{ background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.3)' }}>
                        <div className="text-xs font-bold text-[var(--text-secondary)]">
                            {t(
                                `سعر الباقة ${fmtSAR(price)} ر.س + ضريبة القيمة المضافة ${rate}٪ (${fmtSAR(vat)} ر.س)`,
                                `Plan price ${fmtSAR(price)} SAR + ${rate}% VAT (${fmtSAR(vat)} SAR)`,
                            )}
                        </div>
                        <div className="text-[13px] font-extrabold" style={{ color: '#0d9488' }}>
                            💳 {t(`الإجمالي المستحق: ${fmtSAR(price + vat)} ر.س`, `Total due: ${fmtSAR(price + vat)} SAR`)}
                        </div>
                    </div>
                );
            })()}
            <p className="text-center text-xs text-[var(--text-secondary)] mt-4">
                {t('بوابة دفع آمنة وموثوقة (PayTabs / Moyasar)', 'Secure, trusted payment gateway (PayTabs / Moyasar)')}
            </p>

            {/* فواتير التاجر — تصدر تلقائياً بعد كل اشتراك (v12.17) */}
            <MyInvoices userId={user.id} merchantName={user.shop || user.name || user.id} isRTL={isRTL}
                onBlocked={() => { customAlert(t('السماح بالنوافذ المنبثقة مطلوب لعرض الفاتورة.', 'Pop-ups must be allowed to open the invoice.')); }} />
        </div>
    );
};

export default Subscription;
