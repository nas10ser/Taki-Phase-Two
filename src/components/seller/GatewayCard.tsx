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

interface GatewayState {
    provider: string;
    publishable_key: string | null;
    extra_config: Record<string, string>;
    key_last4: string | null;
    has_secret: boolean;
    has_webhook_secret: boolean;
    payment_modes: 'cod' | 'online' | 'both';
    is_enabled: boolean;
    disabled_by_admin: boolean;
    fail_count: number;
    verified_at: string | null;
    agreement_accepted_at: string | null;
    direct_pay_enabled: boolean;
}

interface ExtraField { k: string; label: string; optional?: boolean }
interface ProviderDef {
    id: string;
    name: string;
    pubLabel?: string;
    secretLabel: string;
    webhookLabel?: string;
    extras?: ExtraField[];
    hasTestMode?: boolean;
}

const PROVIDERS: ProviderDef[] = [
    { id: 'moyasar', name: 'ميسر Moyasar', pubLabel: 'المفتاح العام (pk_...)', secretLabel: 'المفتاح السري (sk_...)', webhookLabel: 'الرمز السري للإشعارات Webhook Secret (اختياري)' },
    { id: 'tap', name: 'تاب Tap', secretLabel: 'المفتاح السري (sk_...)' },
    { id: 'paytabs', name: 'بيتابس PayTabs', secretLabel: 'مفتاح الخادم Server Key', extras: [{ k: 'profile_id', label: 'رقم الملف Profile ID' }] },
    { id: 'payfort', name: 'بيفورت — Amazon Payment Services', secretLabel: 'عبارة توقيع الطلب SHA Request Phrase', webhookLabel: 'عبارة توقيع الرد SHA Response Phrase', extras: [{ k: 'access_code', label: 'رمز الوصول Access Code' }, { k: 'merchant_identifier', label: 'معرّف التاجر Merchant Identifier' }], hasTestMode: true },
    { id: 'hyperpay', name: 'هايبر باي HyperPay', secretLabel: 'رمز الوصول Access Token', extras: [{ k: 'entity_id', label: 'معرّف الكيان Entity ID' }], hasTestMode: true },
    { id: 'checkout', name: 'Checkout.com', pubLabel: 'المفتاح العام (pk_...)', secretLabel: 'المفتاح السري (sk_...)', webhookLabel: 'مفتاح توقيع الإشعارات Webhook Signing Key (اختياري)', extras: [{ k: 'processing_channel_id', label: 'قناة المعالجة Processing Channel ID (اختياري)', optional: true }] },
];

const MODES: Array<{ id: 'cod' | 'online' | 'both'; label: string; hint: string }> = [
    { id: 'cod', label: '🏪 عند الاستلام فقط', hint: 'الوضع الافتراضي — كما هو اليوم' },
    { id: 'online', label: '💳 إلكتروني فقط', hint: 'يختفي خيار الاستلام من ورقة حجز منتجاتك' },
    { id: 'both', label: '🔀 الاثنان معاً', hint: 'المشتري يختار طريقته في ورقة الحجز' },
];

const ERR_AR: Record<string, string> = {
    AGREEMENT_REQUIRED: 'يجب الموافقة على اتفاقية التاجر أولاً',
    KEYS_REQUIRED: 'أدخل المفتاح السري أولاً',
    VERIFY_REQUIRED: 'اضغط «اختبار الاتصال» بنجاح قبل التفعيل',
    NO_GATEWAY: 'احفظ بيانات البوابة أولاً',
    BAD_PROVIDER: 'مزود غير معروف',
    SELLER_ONLY: 'هذه الخاصية لحسابات المتاجر فقط',
};
const errMsg = (e: unknown): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    for (const k of Object.keys(ERR_AR)) if (raw.includes(k)) return ERR_AR[k];
    return raw || 'خطأ غير معروف';
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-color)',
    background: 'var(--body-bg)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.85rem',
    outline: 'none', direction: 'ltr', textAlign: 'left',
};
const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' };

const GatewayCard: React.FC<{ userId: string; isRTL: boolean; onAlert: (msg: string) => void }> = ({ userId, isRTL, onAlert }) => {
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

    const hydrate = useCallback((data: GatewayState | null) => {
        setGw(data);
        if (data) {
            setProvider(data.provider);
            setPub(data.publishable_key || '');
            const ex: Record<string, unknown> = data.extra_config || {};
            setExtra(Object.fromEntries(Object.entries(ex).filter(([k]) => k !== 'test_mode').map(([k, v]) => [k, String(v ?? '')])));
            setTestMode(ex.test_mode === true || String(ex.test_mode) === 'true');
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
            onAlert('✅ تم حفظ بيانات البوابة بأمان — المفاتيح السرية مشفّرة في الخزنة، اضغط «اختبار الاتصال» للتحقق');
        } catch (e) {
            onAlert(`❌ تعذّر الحفظ: ${errMsg(e)}`);
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
                onAlert('✅ الاتصال بالبوابة ناجح — بوابتك مختبرة وجاهزة للتفعيل');
                await load();
            } else {
                onAlert(`❌ فشل اختبار الاتصال: ${data?.error || 'تحقق من المفاتيح'}`);
            }
        } catch (e) {
            onAlert(`❌ تعذّر الاختبار: ${errMsg(e)}`);
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
            onAlert(enable ? '✅ بوابة الدفع مفعّلة — «ادفع الآن» أصبح متاحاً لعملائك حسب وضع طرق الدفع' : '⏸ تم إيقاف بوابة الدفع — منتجاتك تعود للدفع عند الاستلام');
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        } finally {
            setToggling(false);
        }
    };

    const acceptAgreement = async () => {
        if (!agreeChecked) return;
        try {
            // توثيق الموافقة بنسختها وتاريخها (سجل قانوني) ثم ختمها على البوابة
            await supabase.rpc('record_user_consent', { p_terms_version: MERCHANT_GATEWAY_AGREEMENT_VERSION });
            const { data, error } = await supabase.rpc('merchant_accept_gateway_agreement');
            if (error) throw error;
            hydrate(data as GatewayState);
            setAgreementOpen(false);
            setAgreeChecked(false);
            // أكمل التفعيل الذي بدأه التاجر
            const { data: d2, error: e2 } = await supabase.rpc('merchant_toggle_gateway', { p_enabled: true });
            if (e2) throw e2;
            hydrate(d2 as GatewayState);
            onAlert('✅ تمت الموافقة على الاتفاقية وتفعيل بوابة الدفع');
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        }
    };

    const setMode = async (mode: 'cod' | 'online' | 'both') => {
        try {
            const { data, error } = await supabase.rpc('merchant_set_payment_modes', { p_mode: mode });
            if (error) throw error;
            hydrate(data as GatewayState);
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        }
    };

    const webhookUrl = `${supabaseConfig.url}/functions/v1/merchant-pay?op=webhook&provider=${provider}&m=${userId}`;
    const copyWebhook = async () => {
        try {
            await navigator.clipboard.writeText(webhookUrl);
            onAlert('✅ تم نسخ رابط الإشعارات — الصقه في إعدادات Webhook داخل لوحة بوابتك');
        } catch {
            onAlert('❌ تعذّر النسخ — انسخ الرابط يدوياً');
        }
    };

    const statusChip = (bg: string, color: string, text: string) => (
        <span style={{ background: bg, color, borderRadius: 999, padding: '4px 12px', fontSize: '0.68rem', fontWeight: 900 }}>{text}</span>
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
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.95rem' }}>بوابة الدفع — استقبل المدفوعات في حسابك مباشرة</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
                        0% عمولة من تاكي — المبلغ ينتقل من عميلك إلى حساب بوابتك مباشرة
                    </div>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 900 }}>{open ? '▴' : '▾'}</span>
            </button>

            {open && (
                <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {!loaded ? (
                        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.8rem' }}>جاري التحميل…</div>
                    ) : (
                        <>
                            {gw && !gw.direct_pay_enabled && (
                                <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 12, padding: '10px 12px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    ⏸ خاصية الدفع الإلكتروني موقوفة مؤقتاً على مستوى المنصة — إعداداتك محفوظة وستعمل فور إعادة تفعيلها.
                                </div>
                            )}
                            {gw?.disabled_by_admin && (
                                <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 12, padding: '10px 12px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--danger)' }}>
                                    ⛔️ أوقفت الإدارة بوابتك مؤقتاً — منتجاتك على «عند الاستلام» تلقائياً. تواصل مع الإدارة.
                                </div>
                            )}

                            {/* حالة البوابة */}
                            {gw && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {gw.is_enabled
                                        ? statusChip('rgba(16, 185, 129, 0.15)', '#059669', '● مفعّلة')
                                        : statusChip('var(--gray-100)', 'var(--text-secondary)', '○ غير مفعّلة')}
                                    {gw.verified_at
                                        ? statusChip('rgba(16, 185, 129, 0.15)', '#059669', '✓ مختبرة')
                                        : statusChip('rgba(245, 158, 11, 0.15)', '#b45309', '⚠ لم تُختبر بعد')}
                                    {gw.has_secret && statusChip('var(--gray-100)', 'var(--text-secondary)', `🔐 السر: ••••${gw.key_last4 || ''}`)}
                                    {gw.fail_count >= 5 && statusChip('var(--danger-light)', 'var(--danger)', '⛔ فشل متكرر — سقطت مؤقتاً لعند الاستلام')}
                                </div>
                            )}

                            {/* اختيار المزود */}
                            <div>
                                <label style={labelStyle}>مزود بوابة الدفع (حسابك أنت لدى المزود)</label>
                                <select
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                    style={{ ...inputStyle, direction: 'rtl', textAlign: 'right', cursor: 'pointer' }}
                                >
                                    {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>

                            {/* الحقول — المفاتيح السرية كتابة فقط */}
                            {def.pubLabel && (
                                <div>
                                    <label style={labelStyle}>{def.pubLabel}</label>
                                    <input style={inputStyle} value={pub} onChange={e => setPub(e.target.value)} placeholder="pk_..." autoComplete="off" />
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>{def.secretLabel} — كتابة فقط، يُخزَّن مشفّراً ولا يظهر مرة أخرى</label>
                                <input
                                    style={inputStyle} type="password" value={secret}
                                    onChange={e => setSecret(e.target.value)}
                                    placeholder={gw?.has_secret ? `••••••••${gw.key_last4 || ''} (اتركه فارغاً للإبقاء عليه)` : 'أدخل المفتاح السري'}
                                    autoComplete="new-password"
                                />
                            </div>
                            {def.webhookLabel && (
                                <div>
                                    <label style={labelStyle}>{def.webhookLabel}</label>
                                    <input
                                        style={inputStyle} type="password" value={whSecret}
                                        onChange={e => setWhSecret(e.target.value)}
                                        placeholder={gw?.has_webhook_secret ? '•••••••• (اتركه فارغاً للإبقاء عليه)' : 'أدخل الرمز'}
                                        autoComplete="new-password"
                                    />
                                </div>
                            )}
                            {def.extras?.map(f => (
                                <div key={f.k}>
                                    <label style={labelStyle}>{f.label}</label>
                                    <input style={inputStyle} value={extra[f.k] || ''} onChange={e => setExtra(prev => ({ ...prev, [f.k]: e.target.value }))} autoComplete="off" />
                                </div>
                            ))}
                            {def.hasTestMode && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} style={{ width: 18, height: 18 }} />
                                    وضع الاختبار (Sandbox) — بيئة المزود التجريبية
                                </label>
                            )}

                            {/* أزرار الحفظ والاختبار والتفعيل */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" onClick={save} disabled={saving}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                                    {saving ? '⏳ جاري الحفظ…' : '💾 حفظ البيانات'}
                                </button>
                                <button type="button" onClick={test} disabled={testing || !gw?.has_secret}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: '1.5px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: (testing || !gw?.has_secret) ? 0.5 : 1 }}>
                                    {testing ? '⏳ جاري الاختبار…' : '🔌 اختبار الاتصال'}
                                </button>
                                <button type="button" onClick={() => doToggle(!(gw?.is_enabled))} disabled={toggling || !gw}
                                    style={{ flex: 1, minWidth: 120, padding: '12px', borderRadius: 12, border: 'none', background: gw?.is_enabled ? 'var(--danger)' : '#059669', color: '#fff', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', opacity: (toggling || !gw) ? 0.5 : 1 }}>
                                    {gw?.is_enabled ? '⏸ إيقاف البوابة' : '▶️ تفعيل البوابة'}
                                </button>
                            </div>

                            {/* اختيار طرق الدفع — قرار ناصر: التاجر يتحكم بثلاثة أوضاع */}
                            {gw && (
                                <div>
                                    <label style={labelStyle}>طرق الدفع المتاحة لعملائك</label>
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
                                                        <span style={{ display: 'block', fontWeight: 900, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{m.label}</span>
                                                        <span style={{ display: 'block', fontWeight: 700, fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                                            {m.hint}{needsGateway ? ' — يتطلب بوابة مفعّلة ومختبرة' : ''}
                                                        </span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {gw.payment_modes === 'online' && (
                                        <p style={{ margin: '8px 0 0', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                            💡 لو تعطّلت بوابتك لأي سبب، تسقط منتجاتك تلقائياً إلى «عند الاستلام» بدل حجب الحجز عن عملائك.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* رابط الإشعارات للصقه في لوحة المزود */}
                            {gw?.has_secret && (
                                <div style={{ background: 'var(--body-bg)', border: '1px dashed var(--border-color)', borderRadius: 12, padding: '10px 12px' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                        🔔 رابط إشعارات الدفع (Webhook) — الصقه في إعدادات حسابك لدى {def.name}:
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <code style={{ flex: 1, fontSize: '0.62rem', direction: 'ltr', textAlign: 'left', color: 'var(--text-primary)', wordBreak: 'break-all', fontWeight: 600 }}>{webhookUrl}</code>
                                        <button type="button" onClick={copyWebhook}
                                            style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', background: 'var(--gray-100)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.7rem', cursor: 'pointer' }}>
                                            📋 نسخ
                                        </button>
                                    </div>
                                </div>
                            )}

                            <p style={{ margin: 0, fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                🔒 مفاتيحك السرية تُخزَّن مشفّرة (AEAD) في خزنة معزولة ولا يمكن لأحد — ولا حتى إدارة تاكي — قراءتها.
                                بيانات بطاقات عملائك تُدخل على صفحات بوابتك المرخصة مباشرة ولا تمر بتاكي إطلاقاً.
                                الفواتير الضريبية تصدر منك لعملائك، ورسوم البوابة (مدى/فيزا) على حسابك لدى المزود.
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* اتفاقية استخدام التاجر — موافقة إلزامية قبل أول تفعيل */}
            {agreementOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 22, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
                        <h3 style={{ margin: '0 0 12px', fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)' }}>📜 اتفاقية استخدام التاجر — بوابة الدفع</h3>
                        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.9, background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '12px 14px' }}>
                            {MERCHANT_GATEWAY_AGREEMENT}
                        </p>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', margin: '12px 0' }}>
                            <input type="checkbox" checked={agreeChecked} onChange={e => setAgreeChecked(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
                            قرأت الاتفاقية وأوافق عليها بصفتي مالك المتجر، وأتحمل كامل المسؤولية عن مدفوعاتي وفواتيري واستردادات عملائي.
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={acceptAgreement} disabled={!agreeChecked}
                                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: agreeChecked ? 'var(--primary)' : 'var(--gray-200)', color: agreeChecked ? '#fff' : 'var(--text-secondary)', fontWeight: 900, fontSize: '0.85rem', cursor: agreeChecked ? 'pointer' : 'not-allowed' }}>
                                ✅ أوافق وفعّل البوابة
                            </button>
                            <button type="button" onClick={() => { setAgreementOpen(false); setAgreeChecked(false); }}
                                style={{ padding: '12px 18px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer' }}>
                                إلغاء
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GatewayCard;
