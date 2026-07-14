/**
 * AdminMessaging — تبويب «الإشعارات والرسائل» (v12.27)
 *
 * مركز تحكم المالك في رسائل دورة حياة الاشتراك والحجز:
 *  - اشتراك جديد (+ فاتورة بالإيميل)، تنبيه قبل الانتهاء (أيام قابلة للتعديل)،
 *    انتهاء الاشتراك، إلغاء التجديد، وتذكير الحجز (دقائق قابلة للتعديل).
 *  - لكل حدث: تفعيل/إيقاف + نص الرسالة (عربي/إنجليزي) + القنوات (إشعار/إيميل).
 *  - زر «أرسل لي تجربة» يرسل الرسالة الحقيقية للمدير نفسه للتأكد قبل التعميم.
 *
 * التخزين: platform_settings.message_settings (تجاوزات فوق الافتراضيات في
 * قاعدة البيانات taki_msg_defaults) — الكرون والتريغرات تقرأها لحظياً، لا
 * حاجة لأي نشر بعد تعديل الإعدادات.
 *
 * الإيميل: يُصفّ في email_outbox ويرسله سيرفر البوت (Render) عبر SMTP.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminService } from '../../services/adminService';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';

// ─── الأنواع ─────────────────────────────────────────────────────────────────
type EventKey = 'sub_new' | 'sub_warning' | 'sub_expired' | 'sub_cancelled' | 'booking_reminder';

interface EventCfg {
    enabled: boolean;
    channels: { inapp: boolean; email: boolean };
    title_ar: string;
    body_ar: string;
    title_en: string;
    body_en: string;
    days_before?: number;
    minutes_before?: number;
    email_invoice?: boolean;
}

type MsgSettings = Record<EventKey, EventCfg>;

interface OutboxRow {
    id: string; to_email: string; subject: string; event: string | null;
    status: string; last_error: string | null; created_at: string; sent_at: string | null;
}

// ─── الافتراضيات — مرآة taki_msg_defaults() في قاعدة البيانات ───────────────
const DEFAULTS: MsgSettings = {
    sub_new: {
        enabled: true, channels: { inapp: true, email: true }, email_invoice: true,
        title_ar: '🎉 تم تفعيل اشتراكك', title_en: '🎉 Subscription activated',
        body_ar: 'أهلاً {store}! تم تفعيل اشتراكك ({plan}) بمبلغ {price} ر.س حتى {expires}. تجد فاتورتك في صفحة الاشتراك ← «🧾 فواتيري». شكراً لثقتك في تاكي.',
        body_en: 'Welcome {store}! Your subscription ({plan}) of SAR {price} is active until {expires}. Your invoice is on the subscription page → "My invoices". Thank you for choosing TAKI.',
    },
    sub_warning: {
        enabled: true, channels: { inapp: true, email: false }, days_before: 3,
        title_ar: '⏳ اشتراكك يقارب الانتهاء', title_en: '⏳ Your subscription is ending soon',
        body_ar: 'يتبقّى {days} يوم على انتهاء اشتراكك (بتاريخ {expires}). جدّد الآن حتى تستمر عروضك بالظهور دون انقطاع.',
        body_en: '{days} day(s) left until your subscription ends (on {expires}). Renew now to keep your deals live.',
    },
    sub_expired: {
        enabled: true, channels: { inapp: true, email: false },
        title_ar: '🔴 انتهى اشتراكك', title_en: '🔴 Your subscription expired',
        body_ar: 'انتهى اشتراكك وتم إيقاف ظهور عروضك مؤقتاً. جدّد الآن لاستعادتها فوراً.',
        body_en: 'Your subscription expired and your deals were paused. Renew now to restore them instantly.',
    },
    sub_cancelled: {
        enabled: true, channels: { inapp: true, email: false },
        title_ar: '👋 تم إلغاء التجديد التلقائي', title_en: '👋 Auto-renew cancelled',
        body_ar: 'تم إلغاء التجديد التلقائي لاشتراكك بناءً على طلبك. يبقى اشتراكك فعالاً حتى {expires} ولن يُجدَّد تلقائياً.',
        body_en: 'Auto-renew was cancelled as requested. Your subscription stays active until {expires} and will not renew automatically.',
    },
    booking_reminder: {
        enabled: true, channels: { inapp: true, email: false }, minutes_before: 15,
        title_ar: '⏰ باقٍ {minutes} دقيقة على حجزك', title_en: '⏰ {minutes} minutes left on your booking',
        body_ar: 'باقي أقل من {minutes} دقيقة على انتهاء حجز {item}. توجّه للاستلام قبل الإلغاء التلقائي.',
        body_en: 'Less than {minutes} minutes left on your booking for {item}. Head to the store before it auto-cancels.',
    },
};

// ─── تعريف بطاقات الأحداث ────────────────────────────────────────────────────
const EVENT_META: {
    key: EventKey; icon: string; name: string; desc: string;
    placeholders: string[]; numberField?: { field: 'days_before' | 'minutes_before'; label: string; min: number; max: number; unit: string };
}[] = [
    {
        key: 'sub_new', icon: '🎉', name: 'اشتراك جديد / تجديد',
        desc: 'تصل للتاجر فور تفعيل أو تجديد اشتراكه. عند تفعيل قناة الإيميل تُرفق الفاتورة تلقائياً.',
        placeholders: ['{store}', '{plan}', '{price}', '{expires}'],
    },
    {
        key: 'sub_warning', icon: '⏳', name: 'تنبيه قبل انتهاء الاشتراك',
        desc: 'تصل مرة واحدة لكل فترة اشتراك، قبل الانتهاء بعدد الأيام الذي تحدده — لكل مشترك حسب تاريخ انتهائه هو.',
        placeholders: ['{store}', '{days}', '{expires}'],
        numberField: { field: 'days_before', label: 'كم يوم قبل الانتهاء؟', min: 1, max: 60, unit: 'يوم' },
    },
    {
        key: 'sub_expired', icon: '🔴', name: 'انتهاء الاشتراك',
        desc: 'تصل للتاجر لحظة انتهاء اشتراكه وإيقاف عروضه مؤقتاً.',
        placeholders: ['{store}', '{expires}'],
    },
    {
        key: 'sub_cancelled', icon: '👋', name: 'إلغاء التجديد التلقائي',
        desc: 'تصل للتاجر عندما يلغي التجديد التلقائي (يبقى اشتراكه فعالاً حتى نهاية الفترة).',
        placeholders: ['{store}', '{expires}'],
    },
    {
        key: 'booking_reminder', icon: '⏰', name: 'تذكير قبل انتهاء الحجز',
        desc: 'تصل للمشتري قبل انتهاء حجزه بعدد الدقائق الذي تحدده، حتى يستلم قبل الإلغاء التلقائي.',
        placeholders: ['{item}', '{minutes}'],
        numberField: { field: 'minutes_before', label: 'كم دقيقة قبل الانتهاء؟', min: 5, max: 240, unit: 'دقيقة' },
    },
];

const PLACEHOLDER_HELP: Record<string, string> = {
    '{store}': 'اسم المتجر', '{plan}': 'اسم الباقة', '{price}': 'المبلغ',
    '{expires}': 'تاريخ الانتهاء', '{days}': 'عدد الأيام', '{minutes}': 'عدد الدقائق', '{item}': 'اسم المنتج',
};

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
    sent:    { label: '✅ أُرسل',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    pending: { label: '⏳ بالانتظار',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    sending: { label: '📤 يُرسل الآن',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    failed:  { label: '❌ فشل',          cls: 'bg-red-50 text-red-700 border-red-200' },
    expired: { label: '🕓 انتهت صلاحيته', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// دمج تجاوز محفوظ فوق الافتراضيات (كما تفعل قاعدة البيانات تماماً)
function mergeSettings(saved: Partial<Record<EventKey, Partial<EventCfg>>> | null): MsgSettings {
    const out = {} as MsgSettings;
    (Object.keys(DEFAULTS) as EventKey[]).forEach((k) => {
        const d = DEFAULTS[k];
        const s = saved?.[k] ?? {};
        out[k] = { ...d, ...s, channels: { ...d.channels, ...(s.channels ?? {}) } };
    });
    return out;
}

const Toggle: React.FC<{ on: boolean; onFlip: () => void }> = ({ on, onFlip }) => (
    <button
        type="button"
        onClick={onFlip}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-[var(--gray-300)]'}`}
    >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
);

// ─── المكوّن ─────────────────────────────────────────────────────────────────
const AdminMessaging: React.FC = () => {
    const { customAlert } = useApp();
    const [settings, setSettings] = useState<MsgSettings>(DEFAULTS);
    const [emailStatus, setEmailStatus] = useState<{ configured: boolean; from: string } | null>(null);
    const [outbox, setOutbox] = useState<OutboxRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [testing, setTesting] = useState<EventKey | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [saved, status, { data: rows }] = await Promise.all([
            adminService.getPlatformSetting<Partial<Record<EventKey, Partial<EventCfg>>>>('message_settings'),
            adminService.getPlatformSetting<{ configured: boolean; from: string }>('email_sender_status'),
            supabase.from('email_outbox')
                .select('id, to_email, subject, event, status, last_error, created_at, sent_at')
                .order('created_at', { ascending: false })
                .limit(15),
        ]);
        setSettings(mergeSettings(saved));
        setEmailStatus(status ?? null);
        setOutbox((rows as OutboxRow[]) ?? []);
        setLoading(false);
        setDirty(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const patch = (key: EventKey, p: Partial<EventCfg>) => {
        setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
        setDirty(true);
    };
    const patchChannel = (key: EventKey, ch: 'inapp' | 'email', on: boolean) => {
        setSettings((prev) => ({
            ...prev,
            [key]: { ...prev[key], channels: { ...prev[key].channels, [ch]: on } },
        }));
        setDirty(true);
    };

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        const res = await adminService.setPlatformSetting(
            'message_settings', settings,
            'إعدادات رسائل الاشتراك والحجز — من تبويب «الإشعارات والرسائل» (v12.27)'
        );
        setSaving(false);
        if (res.success) {
            setDirty(false);
            await customAlert('✅ تم حفظ الإعدادات — الرسائل القادمة ستستخدمها فوراً (بدون أي نشر).');
        } else {
            await customAlert('❌ فشل الحفظ: ' + (res.error || 'حاول مجدداً'));
        }
    };

    const handleTest = async (key: EventKey) => {
        if (testing) return;
        if (dirty) { await customAlert('⚠️ احفظ الإعدادات أولاً — التجربة ترسل النسخة المحفوظة.'); return; }
        setTesting(key);
        const { data, error } = await supabase.rpc('admin_test_message_event', { p_event: key });
        setTesting(null);
        if (error) {
            await customAlert('❌ فشلت التجربة: ' + error.message);
            return;
        }
        const emailed = (data as any)?.queued_email;
        await customAlert(
            '🧪 وصلك الآن إشعار تجريبي في جرس الإشعارات' +
            (emailed ? '، وأُدرج إيميل تجريبي في صندوق الصادر (يصل خلال دقيقة تقريباً إذا كان المرسل مفعّلاً).' : '.')
        );
        load();
    };

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-28 bg-[var(--gray-100)] rounded-2xl" />
                <div className="h-64 bg-[var(--gray-100)] rounded-2xl" />
                <div className="h-64 bg-[var(--gray-100)] rounded-2xl" />
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-28" dir="rtl">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-500 to-violet-600 rounded-3xl p-6 text-white shadow-lg">
                <h1 className="text-2xl font-extrabold flex items-center gap-2">📨 الإشعارات والرسائل</h1>
                <p className="text-sm opacity-90 mt-1.5 leading-relaxed">
                    تحكم كامل برسائل الاشتراك والحجز: النص، التوقيت (أيام/دقائق)، والقناة (إشعار في الموقع أو إيميل أو الاثنين).
                    التعديلات تسري فوراً على الموقع والتطبيق والبوتين.
                </p>
            </div>

            {/* حالة مرسل الإيميل */}
            <section className={`rounded-2xl border p-4 ${emailStatus?.configured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-start gap-3">
                    <div className="text-3xl">{emailStatus?.configured ? '📧' : '⚙️'}</div>
                    <div className="flex-1 min-w-0">
                        {emailStatus?.configured ? (
                            <>
                                <div className="font-extrabold text-sm text-emerald-900">مرسل الإيميل مفعّل ✅</div>
                                <div className="text-xs text-emerald-800 mt-1">
                                    يُرسل من: <b dir="ltr">{emailStatus.from || '—'}</b> — كل رسالة تفعّل لها قناة «إيميل» ستصل لبريد المستخدم خلال دقيقة تقريباً.
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="font-extrabold text-sm text-amber-900">مرسل الإيميل غير مهيأ بعد</div>
                                <div className="text-xs text-amber-800 mt-1 leading-relaxed">
                                    الرسائل الداخلية (الإشعارات) تعمل الآن. لتفعيل قناة الإيميل، أخبرني «فعّل لي إرسال الإيميل»
                                    وسأرشدك خطوة بخطوة (كلمة مرور تطبيق من Google + إضافتها في Render). حتى ذلك الحين، أي إيميل
                                    يُصفّ في «صندوق الصادر» أدناه بحالة «بالانتظار».
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </section>

            {/* بطاقات الأحداث */}
            {EVENT_META.map((meta) => {
                const cfg = settings[meta.key];
                return (
                    <section key={meta.key} className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] overflow-hidden">
                        {/* رأس البطاقة */}
                        <div className="p-4 flex items-start gap-3 border-b border-[var(--border-color)]">
                            <div className="text-3xl flex-shrink-0">{meta.icon}</div>
                            <div className="flex-1 min-w-0">
                                <div className="font-extrabold text-sm text-[var(--text-primary)]">{meta.name}</div>
                                <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">{meta.desc}</div>
                            </div>
                            <Toggle on={cfg.enabled} onFlip={() => patch(meta.key, { enabled: !cfg.enabled })} />
                        </div>

                        {cfg.enabled && (
                            <div className="p-4 space-y-4">
                                {/* التوقيت */}
                                {meta.numberField && (
                                    <div className="flex items-center gap-3 bg-[var(--body-bg)] rounded-xl p-3 border border-[var(--border-color)]">
                                        <div className="flex-1 text-xs font-bold text-[var(--text-primary)]">⏱ {meta.numberField.label}</div>
                                        <input
                                            type="number"
                                            min={meta.numberField.min}
                                            max={meta.numberField.max}
                                            value={cfg[meta.numberField.field] ?? ''}
                                            onChange={(e) => patch(meta.key, { [meta.numberField!.field]: Number(e.target.value) || meta.numberField!.min } as Partial<EventCfg>)}
                                            className="w-20 px-2 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center outline-none focus:border-indigo-500"
                                        />
                                        <span className="text-xs font-bold text-[var(--text-secondary)]">{meta.numberField.unit}</span>
                                    </div>
                                )}

                                {/* القنوات */}
                                <div>
                                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">📡 أين تصل الرسالة؟</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => patchChannel(meta.key, 'inapp', !cfg.channels.inapp)}
                                            className={`p-3 rounded-xl border-2 text-xs font-bold transition-all ${cfg.channels.inapp ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'}`}
                                        >
                                            🔔 إشعار في الموقع والتطبيق والبوتات
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => patchChannel(meta.key, 'email', !cfg.channels.email)}
                                            className={`p-3 rounded-xl border-2 text-xs font-bold transition-all ${cfg.channels.email ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'}`}
                                        >
                                            📧 إيميل لبريد المستخدم
                                        </button>
                                    </div>
                                    {meta.key === 'sub_new' && cfg.channels.email && (
                                        <div className="mt-2 flex items-center justify-between bg-teal-50 border border-teal-100 rounded-xl p-3">
                                            <div className="text-xs font-bold text-teal-800">🧾 إرفاق الفاتورة داخل الإيميل (المبلغ + الضريبة + الفترة)</div>
                                            <Toggle on={cfg.email_invoice !== false} onFlip={() => patch(meta.key, { email_invoice: cfg.email_invoice === false })} />
                                        </div>
                                    )}
                                </div>

                                {/* النص العربي */}
                                <div className="space-y-2">
                                    <div className="text-xs font-bold text-[var(--text-secondary)]">✍️ نص الرسالة (عربي)</div>
                                    <input
                                        value={cfg.title_ar}
                                        onChange={(e) => patch(meta.key, { title_ar: e.target.value })}
                                        placeholder="العنوان"
                                        className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold outline-none focus:border-indigo-500"
                                    />
                                    <textarea
                                        rows={3}
                                        value={cfg.body_ar}
                                        onChange={(e) => patch(meta.key, { body_ar: e.target.value })}
                                        placeholder="نص الرسالة"
                                        className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none focus:border-indigo-500 leading-relaxed"
                                    />
                                    <div className="flex flex-wrap gap-1.5">
                                        {meta.placeholders.map((ph) => (
                                            <span key={ph} className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5" dir="ltr">
                                                {ph} = {PLACEHOLDER_HELP[ph]}
                                            </span>
                                        ))}
                                        <span className="text-[10px] text-[var(--gray-400)]">انسخ الرمز داخل النص وسيُستبدل تلقائياً بقيمة كل مستخدم</span>
                                    </div>
                                </div>

                                {/* English (collapsible) */}
                                <details className="rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)]">
                                    <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">🌐 النسخة الإنجليزية (لمستخدمي English)</summary>
                                    <div className="p-3 space-y-2">
                                        <input
                                            value={cfg.title_en}
                                            onChange={(e) => patch(meta.key, { title_en: e.target.value })}
                                            placeholder="Title"
                                            dir="ltr"
                                            className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none"
                                        />
                                        <textarea
                                            rows={2}
                                            value={cfg.body_en}
                                            onChange={(e) => patch(meta.key, { body_en: e.target.value })}
                                            placeholder="Body"
                                            dir="ltr"
                                            className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none"
                                        />
                                    </div>
                                </details>

                                {/* تجربة */}
                                <button
                                    type="button"
                                    onClick={() => handleTest(meta.key)}
                                    disabled={testing !== null}
                                    className="w-full py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-extrabold transition-all disabled:opacity-50"
                                >
                                    {testing === meta.key ? 'جاري الإرسال...' : '🧪 أرسل لي تجربة (تصلني أنا فقط)'}
                                </button>
                            </div>
                        )}
                    </section>
                );
            })}

            {/* صندوق الصادر */}
            <section className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <div className="font-extrabold text-sm text-[var(--text-primary)]">📮 صندوق الإيميل الصادر (آخر 15)</div>
                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">كل إيميل يمر من هنا — تتأكد بنفسك أنه أُرسل فعلاً.</div>
                    </div>
                    <button
                        type="button"
                        onClick={load}
                        className="px-3 py-1.5 rounded-lg bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-xs font-bold text-[var(--text-secondary)]"
                    >
                        🔄 تحديث
                    </button>
                </div>
                {outbox.length === 0 ? (
                    <div className="text-center text-xs text-[var(--text-secondary)] py-6 border border-dashed border-[var(--border-color)] rounded-xl">
                        لا توجد إيميلات بعد — ستظهر هنا عند أول رسالة تفعّل لها قناة «إيميل».
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {outbox.map((m) => {
                            const chip = STATUS_CHIP[m.status] ?? { label: m.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
                            return (
                                <div key={m.id} className="flex items-center gap-2 border border-[var(--border-color)] rounded-xl px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-[var(--text-primary)] truncate">{m.subject}</div>
                                        <div className="text-[10px] text-[var(--gray-400)] truncate" dir="ltr">
                                            {m.to_email} — {new Date(m.created_at).toLocaleString('ar-SA')}
                                        </div>
                                        {m.status === 'failed' && m.last_error && (
                                            <div className="text-[10px] text-red-600 truncate mt-0.5" dir="ltr">{m.last_error}</div>
                                        )}
                                    </div>
                                    <span className={`flex-shrink-0 text-[10px] font-extrabold border rounded-full px-2 py-1 ${chip.cls}`}>{chip.label}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* شريط الحفظ الثابت */}
            {dirty && (
                <div className="fixed bottom-20 inset-x-0 z-40 px-4 pointer-events-none">
                    <div className="max-w-2xl mx-auto pointer-events-auto bg-[var(--card-bg)] border border-indigo-200 shadow-2xl rounded-2xl p-3 flex items-center gap-3">
                        <div className="flex-1 text-xs font-bold text-[var(--text-primary)]">لديك تعديلات غير محفوظة</div>
                        <button
                            type="button"
                            onClick={load}
                            className="px-4 py-2.5 rounded-xl bg-[var(--gray-100)] text-xs font-bold text-[var(--text-secondary)]"
                        >
                            تراجع
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-extrabold shadow disabled:opacity-50"
                        >
                            {saving ? 'جاري الحفظ...' : '💾 حفظ الإعدادات'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminMessaging;
