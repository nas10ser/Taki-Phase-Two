/**
 * GatewayCard v12.81 — بطاقة «💳 بوابة الدفع» في لوحة التاجر.
 *
 * الدفع المباشر لحساب التاجر (0% عمولة): التاجر يربط حسابه هو في إحدى
 * بوابات الدفع الست المرخصة (ميسر/تاب/بيتابس/بيفورت/هايبر باي/Checkout.com)
 * فيدفع المشتري إلى حساب التاجر مباشرة — تاكي لا تلمس المال إطلاقاً.
 *
 * أمان: المفاتيح السرية كتابة-فقط (تذهب إلى Supabase Vault عبر RPC معرّفة
 * ولا يوجد أي مسار يعيدها — الواجهة ترى آخر ٤ خانات فقط). التفعيل يتطلب:
 * موافقة اتفاقية التاجر + «اختبار الاتصال» الناجح.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfig } from '../../services/supabaseClient';
import { MERCHANT_GATEWAY_AGREEMENT, MERCHANT_GATEWAY_AGREEMENT_VERSION } from '../../data/legalTexts';
import { createT } from '../../utils/helpers';

interface GatewayState {
    provider?: string;
    publishable_key?: string | null;
    extra_config?: Record<string, string>;
    key_last4?: string | null;
    has_secret?: boolean;
    has_webhook_secret?: boolean;
    payment_modes?: 'cod' | 'online' | 'both';
    is_enabled?: boolean;
    disabled_by_admin?: boolean;
    fail_count?: number;
    verified_at?: string | null;
    agreement_accepted_at?: string | null;
    /** v12.82 — مزود التاجر الحالي مفتوح من ناصر؟ */
    provider_enabled?: boolean;
    /** v12.82 — المزودون الذين فتحهم ناصر (خدمة خدمة) — الاختيار مقصور عليهم */
    enabled_providers?: string[];
    direct_pay_enabled?: boolean;
}

/** v14.63 — البطاقة كانت عربية بالكامل رغم أنها تستقبل `isRTL` أصلاً: تاجرٌ
 *  إنجليزيّ يُطلب منه لصقُ مفاتيح بوابة دفعه في حقولٍ لا يقرؤها. كل نصّ هنا
 *  صار زوجاً (ar/en) — الجداول كما في `BottomNav`، والنصوص عبر `createT`. */
interface TxT { ar: string; en: string }
interface ExtraField { k: string; label: TxT; optional?: boolean }
interface ProviderDef {
    id: string;
    name: TxT;
    pubLabel?: TxT;
    secretLabel: TxT;
    webhookLabel?: TxT;
    extras?: ExtraField[];
    hasTestMode?: boolean;
    /** v12.83 — الوضع التجريبي: لا مفاتيح من التاجر إطلاقاً (سر داخلي يُولَّد تلقائياً) */
    noKeys?: boolean;
}

const PROVIDERS: ProviderDef[] = [
    { id: 'sim', name: { ar: '🧪 الوضع التجريبي — محاكاة دفع (بدون أموال حقيقية)', en: '🧪 Test mode — simulated payments (no real money)' }, secretLabel: { ar: '', en: '' }, noKeys: true },
    { id: 'moyasar', name: { ar: 'ميسر Moyasar', en: 'Moyasar' }, pubLabel: { ar: 'المفتاح العام (pk_...)', en: 'Publishable key (pk_…)' }, secretLabel: { ar: 'المفتاح السري (sk_...)', en: 'Secret key (sk_…)' }, webhookLabel: { ar: 'الرمز السري للإشعارات Webhook Secret (اختياري)', en: 'Webhook secret (optional)' } },
    { id: 'tap', name: { ar: 'تاب Tap', en: 'Tap' }, secretLabel: { ar: 'المفتاح السري (sk_...)', en: 'Secret key (sk_…)' } },
    { id: 'paytabs', name: { ar: 'بيتابس PayTabs', en: 'PayTabs' }, secretLabel: { ar: 'مفتاح الخادم Server Key', en: 'Server key' }, extras: [{ k: 'profile_id', label: { ar: 'رقم الملف Profile ID', en: 'Profile ID' } }] },
    { id: 'payfort', name: { ar: 'بيفورت — Amazon Payment Services', en: 'PayFort — Amazon Payment Services' }, secretLabel: { ar: 'عبارة توقيع الطلب SHA Request Phrase', en: 'SHA request phrase' }, webhookLabel: { ar: 'عبارة توقيع الرد SHA Response Phrase', en: 'SHA response phrase' }, extras: [{ k: 'access_code', label: { ar: 'رمز الوصول Access Code', en: 'Access code' } }, { k: 'merchant_identifier', label: { ar: 'معرّف التاجر Merchant Identifier', en: 'Merchant identifier' } }], hasTestMode: true },
    { id: 'hyperpay', name: { ar: 'هايبر باي HyperPay', en: 'HyperPay' }, secretLabel: { ar: 'رمز الوصول Access Token', en: 'Access token' }, extras: [{ k: 'entity_id', label: { ar: 'معرّف الكيان Entity ID', en: 'Entity ID' } }], hasTestMode: true },
    { id: 'checkout', name: { ar: 'Checkout.com', en: 'Checkout.com' }, pubLabel: { ar: 'المفتاح العام (pk_...)', en: 'Publishable key (pk_…)' }, secretLabel: { ar: 'المفتاح السري (sk_...)', en: 'Secret key (sk_…)' }, webhookLabel: { ar: 'مفتاح توقيع الإشعارات Webhook Signing Key (اختياري)', en: 'Webhook signing key (optional)' }, extras: [{ k: 'processing_channel_id', label: { ar: 'قناة المعالجة Processing Channel ID (اختياري)', en: 'Processing channel ID (optional)' }, optional: true }] },
];

const MODES: Array<{ id: 'cod' | 'online' | 'both'; label: TxT; hint: TxT }> = [
    { id: 'cod', label: { ar: '🏪 عند الاستلام فقط', en: '🏪 Cash on pickup only' }, hint: { ar: 'الوضع الافتراضي — كما هو اليوم', en: 'The default — exactly as it works today' } },
    { id: 'online', label: { ar: '💳 إلكتروني فقط', en: '💳 Online payment only' }, hint: { ar: 'يختفي خيار الاستلام من ورقة حجز منتجاتك', en: 'The pay-on-pickup option disappears from your booking sheet' } },
    { id: 'both', label: { ar: '🔀 الاثنان معاً', en: '🔀 Both' }, hint: { ar: 'المشتري يختار طريقته في ورقة الحجز', en: 'The buyer picks their method in the booking sheet' } },
];

const ERRORS: Record<string, TxT> = {
    AGREEMENT_REQUIRED: { ar: 'يجب الموافقة على اتفاقية التاجر أولاً', en: 'You must accept the merchant agreement first' },
    KEYS_REQUIRED: { ar: 'أدخل المفتاح السري أولاً', en: 'Enter the secret key first' },
    VERIFY_REQUIRED: { ar: 'اضغط «اختبار الاتصال» بنجاح قبل التفعيل', en: 'Run “Test connection” successfully before enabling' },
    NO_GATEWAY: { ar: 'احفظ بيانات البوابة أولاً', en: 'Save the gateway details first' },
    BAD_PROVIDER: { ar: 'مزود غير معروف', en: 'Unknown provider' },
    SELLER_ONLY: { ar: 'هذه الخاصية لحسابات المتاجر فقط', en: 'This feature is for merchant accounts only' },
};
const errMsg = (e: unknown, isRTL: boolean): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    for (const k of Object.keys(ERRORS)) if (raw.includes(k)) return isRTL ? ERRORS[k].ar : ERRORS[k].en;
    return raw || (isRTL ? 'خطأ غير معروف' : 'Unknown error');
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-color)',
    background: 'var(--body-bg)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.85rem',
    outline: 'none', direction: 'ltr', textAlign: 'left',
};
const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' };

const GatewayCard: React.FC<{ userId: string; isRTL: boolean; onAlert: (msg: string) => void }> = ({ userId, isRTL, onAlert }) => {
    const t = createT(isRTL);
    /** نصّ من زوج (ar/en) في جداول المزودين وطرق الدفع. */
    const L = (x: TxT | undefined): string => (x ? (isRTL ? x.ar : x.en) : '');
    const [open, setOpen] = useState(false);
    const [gw, setGw] = useState<GatewayState | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [provider, setProvider] = useState('moyasar');
    const [pub, setPub] = useState('');
    const [secret, setSecret] = useState('');
    const [whSecret, setWhSecret] = useState('');
    const [extra, setExtra] = useState<Record<string, string>>({});
    const [testMode, setTestMode] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [agreeChecked, setAgreeChecked] = useState(false);

    const def = useMemo(() => PROVIDERS.find(p => p.id === provider) || PROVIDERS[0], [provider]);
    // v12.82 — الاختيار مقصور على المزودين الذين فتحهم ناصر (+ مزود التاجر
    // الحالي إن أُغلق لاحقاً — يظهر معلَّماً «موقوف» بدل أن يختفي بياناته)
    const enabledIds = gw?.enabled_providers || [];
    const visibleProviders = useMemo(
        () => PROVIDERS.filter(p => enabledIds.includes(p.id) || p.id === gw?.provider),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [gw?.enabled_providers, gw?.provider]
    );
    const configured = !!gw?.provider;

    const hydrate = useCallback((data: GatewayState | null) => {
        setGw(data);
        if (data?.provider) {
            setProvider(data.provider);
            setPub(data.publishable_key || '');
            const ex: Record<string, unknown> = data.extra_config || {};
            setExtra(Object.fromEntries(Object.entries(ex).filter(([k]) => k !== 'test_mode').map(([k, v]) => [k, String(v ?? '')])));
            setTestMode(ex.test_mode === true || String(ex.test_mode) === 'true');
        } else if (data?.enabled_providers?.length) {
            setProvider(prev => (data.enabled_providers!.includes(prev) ? prev : data.enabled_providers![0]));
        }
    }, []);

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_my_gateway');
        if (!error) hydrate((data as GatewayState) || null);
        setLoaded(true);
    }, [hydrate]);

    useEffect(() => { if (open && !loaded) load(); }, [open, loaded, load]);

    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const extraPayload: Record<string, unknown> = { ...extra };
            if (def.hasTestMode) extraPayload.test_mode = testMode;
            const { data, error } = await supabase.rpc('merchant_set_gateway', {
                p_provider: provider,
                p_publishable_key: pub.trim() || null,
                p_secret_key: secret.trim() || null,
                p_webhook_secret: whSecret.trim() || null,
                p_extra: extraPayload,
            });
            if (error) throw error;
            hydrate(data as GatewayState);
            setSecret('');
            setWhSecret('');
            onAlert(t('✅ تم حفظ بيانات البوابة بأمان — المفاتيح السرية مشفّرة في الخزنة، اضغط «اختبار الاتصال» للتحقق',
                      '✅ Gateway details saved securely — secret keys are encrypted in the vault. Tap “Test connection” to verify.'));
        } catch (e) {
            onAlert(t('❌ تعذّر الحفظ: ', '❌ Could not save: ') + errMsg(e, isRTL));
        } finally {
            setSaving(false);
        }
    };

    const test = async () => {
        if (testing) return;
        setTesting(true);
        try {
            const { data, error } = await supabase.functions.invoke('merchant-pay', { body: { op: 'verify' } });
            if (error) throw error;
            if (data?.ok) {
                onAlert(t('✅ الاتصال بالبوابة ناجح — بوابتك مختبرة وجاهزة للتفعيل',
                          '✅ Connected to the gateway — your gateway is tested and ready to enable.'));
                await load();
            } else if (data?.error === 'PROVIDER_DISABLED') {
                onAlert(t('⏸ هذا المزود غير مفتوح من الإدارة حالياً — اختر مزوداً مفتوحاً أو انتظر فتحه',
                          '⏸ This provider is not open right now — pick an open provider or wait until it is enabled.'));
            } else {
                onAlert(t('❌ فشل اختبار الاتصال: ', '❌ Connection test failed: ')
                    + (data?.error || t('تحقق من المفاتيح', 'check your keys')));
            }
        } catch (e) {
            onAlert(t('❌ تعذّر الاختبار: ', '❌ Could not run the test: ') + errMsg(e, isRTL));
        } finally {
            setTesting(false);
        }
    };

    const doToggle = async (enable: boolean) => {
        if (toggling) return;
        // التفعيل الأول يمر إلزامياً عبر اتفاقية التاجر (الدرع القانوني)
        if (enable && gw && !gw.agreement_accepted_at) {
            setAgreementOpen(true);
            return;
        }
        setToggling(true);
        try {
            const { data, error } = await supabase.rpc('merchant_toggle_gateway', { p_enabled: enable });
            if (error) throw error;
            hydrate(data as GatewayState);
            onAlert(enable
                ? t('✅ بوابة الدفع مفعّلة — «ادفع الآن» أصبح متاحاً لعملائك حسب وضع طرق الدفع',
                    '✅ Payment gateway enabled — “Pay now” is live for your customers, per your payment-methods setting.')
                : t('⏸ تم إيقاف بوابة الدفع — منتجاتك تعود للدفع عند الاستلام',
                    '⏸ Payment gateway disabled — your products go back to pay-on-pickup.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setToggling(false);
        }
    };

    const acceptAgreement = async () => {
        if (!agreeChecked) return;
        try {
            // توثيق الموافقة بنسختها وتاريخها (سجل قانوني) ثم ختمها على البوابة.
            // v14.19 — `p_kind:'gateway'` يكتبها في عمودها الخاص. 🪤 كانت تُكتب
            // في `consent_terms_version` نفسه فتدهس إصدارَ الشروط الذي وافق عليه
            // التاجر — فضاع الأثر القانوني عند اثنين من ستّة مستخدمين.
            await supabase.rpc('record_user_consent', {
                p_terms_version: MERCHANT_GATEWAY_AGREEMENT_VERSION,
                p_kind: 'gateway',
            });
            const { data, error } = await supabase.rpc('merchant_accept_gateway_agreement');
            if (error) throw error;
            hydrate(data as GatewayState);
            setAgreementOpen(false);
            setAgreeChecked(false);
            // أكمل التفعيل الذي بدأه التاجر
            const { data: d2, error: e2 } = await supabase.rpc('merchant_toggle_gateway', { p_enabled: true });
            if (e2) throw e2;
            hydrate(d2 as GatewayState);
            onAlert(t('✅ تمت الموافقة على الاتفاقية وتفعيل بوابة الدفع', '✅ Agreement accepted and the payment gateway is enabled.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        }
    };

    const setMode = async (mode: 'cod' | 'online' | 'both') => {
        try {
            const { data, error } = await supabase.rpc('merchant_set_payment_modes', { p_mode: mode });
            if (error) throw error;
            hydrate(data as GatewayState);
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        }
    };

    const webhookUrl = `${supabaseConfig.url}/functions/v1/merchant-pay?op=webhook&provider=${provider}&m=${userId}`;
    const copyWebhook = async () => {
        try {
            await navigator.clipboard.writeText(webhookUrl);
            onAlert(t('✅ تم نسخ رابط الإشعارات — الصقه في إعدادات Webhook داخل لوحة بوابتك',
                      '✅ Webhook URL copied — paste it into the webhook settings of your gateway dashboard.'));
        } catch {
            onAlert(t('❌ تعذّر النسخ — انسخ الرابط يدوياً', '❌ Could not copy — copy the URL manually.'));
        }
    };

    const statusChip = (bg: string, color: string, text: string) => (
        <span style={{ background: bg, color, borderRadius: 999, padding: '4px 12px', fontSize: '0.75rem', fontWeight: 900 }}>{text}</span>
    );

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, overflow: 'hidden' }}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: isRTL ? 'right' : 'left', fontFamily: 'inherit' }}
            >
                <span style={{ fontSize: '1.5rem' }}>💳</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                            {t('بوابة الدفع — استقبل المدفوعات في حسابك مباشرة', 'Payment gateway — take payments straight into your own account')}
                        </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {t('0% عمولة من تاكي — المبلغ ينتقل من عميلك إلى حساب بوابتك مباشرة',
                           '0% commission from TAKI — the money goes from your customer to your own gateway account')}
                    </div>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 900 }}>{open ? '▴' : '▾'}</span>
            </button>

            {open && (
                <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {!loaded ? (
                        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.8rem' }}>{t('جاري التحميل…', 'Loading…')}</div>
                    ) : (
                        <>
                            {gw && !gw.direct_pay_enabled && (
                                <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 12, padding: '10px 12px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    ⏸ {t('خاصية الدفع الإلكتروني موقوفة مؤقتاً على مستوى المنصة — إعداداتك محفوظة وستعمل فور إعادة تفعيلها.',
                                          'Online payments are paused platform-wide right now — your settings are saved and resume the moment it is switched back on.')}
                                </div>
                            )}
                            {gw?.disabled_by_admin && (
                                <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 12, padding: '10px 12px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--danger)' }}>
                                    ⛔️ {t('أوقفت الإدارة بوابتك مؤقتاً — منتجاتك على «عند الاستلام» تلقائياً. تواصل مع الإدارة.',
                                           'Your gateway has been paused by the platform — your products fall back to pay-on-pickup. Please get in touch.')}
                                </div>
                            )}
                            {/* v12.82 — مزود التاجر الحالي أغلقته الإدارة */}
                            {configured && gw?.provider_enabled === false && (
                                <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 12, padding: '10px 12px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    ⏸ {t('مزود بوابتك', 'Your gateway provider')} ({L(PROVIDERS.find(p => p.id === gw?.provider)?.name) || gw?.provider}) {t(
                                        'غير مفتوح حالياً من الإدارة — بياناتك محفوظة، ومنتجاتك على «عند الاستلام» تلقائياً حتى يُعاد فتحه أو تختار مزوداً مفتوحاً.',
                                        'is not open right now — your details are saved, and your products stay on pay-on-pickup until it reopens or you pick an open provider.')}
                                </div>
                            )}

                            {/* v12.82 — الإدارة لم تفتح أي مزود بعد: لا نعرض النموذج إطلاقاً */}
                            {!configured && enabledIds.length === 0 ? (
                                <div style={{ background: 'var(--body-bg)', border: '1px dashed var(--border-color)', borderRadius: 14, padding: '18px 16px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>⏳</div>
                                    <div style={{ fontWeight: 900, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{t('خدمة الدفع الإلكتروني قادمة قريباً', 'Online payments are coming soon')}</div>
                                    <p style={{ margin: '6px 0 0', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                        {t('الإدارة لم تفتح بوابات الدفع بعد. عند فتحها ستربط حساب بوابتك الخاص هنا وتستقبل مدفوعات عملائك في حسابك مباشرة — دون أي عمولة من تاكي.',
                                           'Payment gateways are not open yet. Once they are, you will connect your own gateway account here and receive your customers’ payments directly — with no commission from TAKI.')}
                                    </p>
                                </div>
                            ) : (
                            <>


                            {/* حالة البوابة */}
                            {configured && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {gw.is_enabled
                                        ? statusChip('rgba(16, 185, 129, 0.15)', '#059669', t('● مفعّلة', '● Enabled'))
                                        : statusChip('var(--gray-100)', 'var(--text-secondary)', t('○ غير مفعّلة', '○ Not enabled'))}
                                    {gw.verified_at
                                        ? statusChip('rgba(16, 185, 129, 0.15)', '#059669', t('✓ مختبرة', '✓ Tested'))
                                        : statusChip('rgba(245, 158, 11, 0.15)', '#b45309', t('⚠ لم تُختبر بعد', '⚠ Not tested yet'))}
                                    {gw.has_secret && statusChip('var(--gray-100)', 'var(--text-secondary)', t(`🔐 السر: ••••${gw.key_last4 || ''}`, `🔐 Secret: ••••${gw.key_last4 || ''}`))}
                                    {(gw.fail_count ?? 0) >= 5 && statusChip('var(--danger-light)', 'var(--danger)', t('⛔ فشل متكرر — سقطت مؤقتاً لعند الاستلام', '⛔ Repeated failures — temporarily fell back to pay-on-pickup'))}
                                </div>
                            )}

                            {/* اختيار المزود */}
                            <div>
                                <label style={labelStyle}>{t('مزود بوابة الدفع (حسابك أنت لدى المزود)', 'Payment gateway provider (your own account with them)')}</label>
                                <select
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                    style={{ ...inputStyle, direction: isRTL ? 'rtl' : 'ltr', textAlign: isRTL ? 'right' : 'left', cursor: 'pointer' }}
                                >
                                    {visibleProviders.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {L(p.name)}{!enabledIds.includes(p.id) ? t(' — ⏸ موقوف من الإدارة', ' — ⏸ paused by the platform') : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* الحقول — المفاتيح السرية كتابة فقط */}
                            {/* v12.83 — المحاكاة بلا مفاتيح: شرح بدل الحقول */}
                            {def.noKeys && (
                                <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px dashed rgba(245, 158, 11, 0.5)', borderRadius: 14, padding: '12px 14px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.8 }}>
                                    {isRTL ? (
                                        <>🧪 <b>وضع تجريبي كامل:</b> لا يحتاج أي مفاتيح أو حساب بنكي — كل خطوات الدفع تعمل
                                        (صفحة دفع، تأكيد، سجل، إشعارات) لكن <b>لا يُخصم أي ريال حقيقي</b>، وكل الرسائل
                                        تصرّح أنها محاكاة. مناسب لتجربة النظام قبل ربط بوابة حقيقية.
                                        فقط اضغط «حفظ البيانات» ثم «اختبار الاتصال» ثم «تفعيل».</>
                                    ) : (
                                        <>🧪 <b>Full test mode:</b> no keys and no bank account needed — every payment step works
                                        (checkout page, confirmation, history, notifications) but <b>no real money is charged</b>, and every
                                        message says it is a simulation. Good for trying the system before connecting a real gateway.
                                        Just tap “Save details”, then “Test connection”, then “Enable”.</>
                                    )}
                                </div>
                            )}
                            {!def.noKeys && def.pubLabel && (
                                <div>
                                    <label style={labelStyle}>{L(def.pubLabel)}</label>
                                    <input style={inputStyle} value={pub} onChange={e => setPub(e.target.value)} placeholder="pk_..." autoComplete="off" />
                                </div>
                            )}
                            {!def.noKeys && (
                            <div>
                                <label style={labelStyle}>{L(def.secretLabel)}{t(' — كتابة فقط، يُخزَّن مشفّراً ولا يظهر مرة أخرى', ' — write-only, stored encrypted and never shown again')}</label>
                                <input
                                    style={inputStyle} type="password" value={secret}
                                    onChange={e => setSecret(e.target.value)}
                                    placeholder={gw?.has_secret
                                        ? t(`••••••••${gw.key_last4 || ''} (اتركه فارغاً للإبقاء عليه)`, `••••••••${gw.key_last4 || ''} (leave empty to keep it)`)
                                        : t('أدخل المفتاح السري', 'Enter the secret key')}
                                    autoComplete="new-password"
                                />
                            </div>
                            )}
                            {def.webhookLabel && (
                                <div>
                                    <label style={labelStyle}>{L(def.webhookLabel)}</label>
                                    <input
                                        style={inputStyle} type="password" value={whSecret}
                                        onChange={e => setWhSecret(e.target.value)}
                                        placeholder={gw?.has_webhook_secret
                                            ? t('•••••••• (اتركه فارغاً للإبقاء عليه)', '•••••••• (leave empty to keep it)')
                                            : t('أدخل الرمز', 'Enter the secret')}
                                        autoComplete="new-password"
                                    />
                                </div>
                            )}
                            {def.extras?.map(f => (
                                <div key={f.k}>
                                    <label style={labelStyle}>{L(f.label)}</label>
                                    <input style={inputStyle} value={extra[f.k] || ''} onChange={e => setExtra(prev => ({ ...prev, [f.k]: e.target.value }))} autoComplete="off" />
                                </div>
                            ))}
                            {def.hasTestMode && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} style={{ width: 18, height: 18 }} />
                                    {t('وضع الاختبار (Sandbox) — بيئة المزود التجريبية', 'Sandbox mode — the provider’s test environment')}
                                </label>
                            )}

                            {/* أزرار الحفظ والاختبار والتفعيل */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" onClick={save} disabled={saving}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                                    {saving ? t('⏳ جاري الحفظ…', '⏳ Saving…') : t('💾 حفظ البيانات', '💾 Save details')}
                                </button>
                                <button type="button" onClick={test} disabled={testing || !gw?.has_secret}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: '1.5px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: (testing || !gw?.has_secret) ? 0.5 : 1 }}>
                                    {testing ? t('⏳ جاري الاختبار…', '⏳ Testing…') : t('🔌 اختبار الاتصال', '🔌 Test connection')}
                                </button>
                                <button type="button" onClick={() => doToggle(!(gw?.is_enabled))} disabled={toggling || !configured}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: 'none', background: gw?.is_enabled ? 'var(--danger)' : '#059669', color: '#fff', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: (toggling || !configured) ? 0.5 : 1 }}>
                                    {gw?.is_enabled ? t('⏸ إيقاف البوابة', '⏸ Disable gateway') : t('▶️ تفعيل البوابة', '▶️ Enable gateway')}
                                </button>
                            </div>

                            {/* اختيار طرق الدفع — قرار ناصر: التاجر يتحكم بثلاثة أوضاع */}
                            {configured && (
                                <div>
                                    <label style={labelStyle}>{t('طرق الدفع المتاحة لعملائك', 'Payment methods available to your customers')}</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {MODES.map(m => {
                                            const active = gw.payment_modes === m.id;
                                            const needsGateway = m.id !== 'cod' && (!gw.verified_at || !gw.is_enabled);
                                            return (
                                                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12,
                                                        border: active ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                                        background: active ? 'var(--notif-unread-bg)' : 'var(--body-bg)',
                                                        cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit', width: '100%',
                                                    }}>
                                                    <span style={{
                                                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                                                        border: active ? '6px solid var(--primary)' : '2px solid var(--gray-300)', background: 'var(--card-bg)',
                                                    }} />
                                                    <span style={{ flex: 1 }}>
                                                        <span style={{ display: 'block', fontWeight: 900, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{L(m.label)}</span>
                                                        <span style={{ display: 'block', fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                                            {L(m.hint)}{needsGateway ? t(' — يتطلب بوابة مفعّلة ومختبرة', ' — requires an enabled, tested gateway') : ''}
                                                        </span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {gw.payment_modes === 'online' && (
                                        <p style={{ margin: '8px 0 0', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                            💡 {t('لو تعطّلت بوابتك لأي سبب، تسقط منتجاتك تلقائياً إلى «عند الاستلام» بدل حجب الحجز عن عملائك.',
                                                   'If your gateway fails for any reason, your products fall back to pay-on-pickup automatically instead of blocking bookings.')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* رابط الإشعارات للصقه في لوحة المزود (لا webhooks في المحاكاة) */}
                            {gw?.has_secret && provider !== 'sim' && (
                                <div style={{ background: 'var(--body-bg)', border: '1px dashed var(--border-color)', borderRadius: 12, padding: '10px 12px' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                        🔔 {t('رابط إشعارات الدفع (Webhook) — الصقه في إعدادات حسابك لدى', 'Payment webhook URL — paste it into your account settings at')} {L(def.name)}:
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <code style={{ flex: 1, fontSize: '0.75rem', direction: 'ltr', textAlign: 'left', color: 'var(--text-primary)', wordBreak: 'break-all', fontWeight: 600 }}>{webhookUrl}</code>
                                        <button type="button" onClick={copyWebhook}
                                            style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', background: 'var(--gray-100)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.7rem', cursor: 'pointer' }}>
                                            📋 {t('نسخ', 'Copy')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                🔒 {t(
                                    'مفاتيحك السرية تُخزَّن مشفّرة (AEAD) في خزنة معزولة ولا يمكن لأحد — ولا حتى إدارة تاكي — قراءتها. بيانات بطاقات عملائك تُدخل على صفحات بوابتك المرخصة مباشرة ولا تمر بتاكي إطلاقاً. الفواتير الضريبية تصدر منك لعملائك، ورسوم البوابة (مدى/فيزا) على حسابك لدى المزود.',
                                    'Your secret keys are stored encrypted (AEAD) in an isolated vault that nobody — not even TAKI — can read. Your customers’ card details are entered on your licensed gateway’s own pages and never pass through TAKI. Tax invoices are issued by you to your customers, and gateway fees (mada/Visa) sit on your account with the provider.')}
                            </p>
                            </>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* اتفاقية استخدام التاجر — موافقة إلزامية قبل أول تفعيل */}
            {agreementOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 22, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
                        <h3 style={{ margin: '0 0 12px', fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)' }}>📜 {t('اتفاقية استخدام التاجر — بوابة الدفع', 'Merchant agreement — payment gateway')}</h3>
                        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.9, background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '12px 14px' }}>
                            {MERCHANT_GATEWAY_AGREEMENT}
                        </p>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', margin: '12px 0' }}>
                            <input type="checkbox" checked={agreeChecked} onChange={e => setAgreeChecked(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
                            {t('قرأت الاتفاقية وأوافق عليها بصفتي مالك المتجر، وأتحمل كامل المسؤولية عن مدفوعاتي وفواتيري واستردادات عملائي.',
                               'I have read and accept this agreement as the store owner, and I take full responsibility for my payments, my invoices and my customers’ refunds.')}
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={acceptAgreement} disabled={!agreeChecked}
                                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: agreeChecked ? 'var(--primary)' : 'var(--gray-200)', color: agreeChecked ? '#fff' : 'var(--text-secondary)', fontWeight: 900, fontSize: '0.85rem', cursor: agreeChecked ? 'pointer' : 'not-allowed' }}>
                                ✅ {t('أوافق وفعّل البوابة', 'I agree — enable the gateway')}
                            </button>
                            <button type="button" onClick={() => { setAgreementOpen(false); setAgreeChecked(false); }}
                                style={{ padding: '12px 18px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer' }}>
                                {t('إلغاء', 'Cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GatewayCard;
