/**
 * PushOptIn — زرّ تفعيل إشعارات الجوّال (v14.13)
 * ═══════════════════════════════════════════════════════════════════════════
 * يظهر **بعد أن يصبح للإشعار معنى**: للمشتري بعد أول حجز، وللتاجر في حسابه.
 * قبل v14.13 كان التطبيق يطلب الإذن لحظة الفتح مقابل لا شيء يراه المستخدم —
 * وأغلب الناس يرفضون، والرفض على الويب شبه نهائي فلا يُعاد السؤال أبداً.
 *
 * ثلاث حالات يقولها صراحةً بدل الصمت:
 *   • آيفون غير مثبَّت ⇒ لا إشعارات أصلاً حتى «إضافة إلى الشاشة الرئيسية».
 *   • مرفوض سابقاً ⇒ لا يستطيع الموقع إعادة السؤال؛ يُفتح من إعدادات المتصفّح.
 *   • متصفّح لا يدعمها ⇒ لا نعرض شيئاً (لا نَعِد بما لا نستطيع).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { pushService, PushState } from '../services/pushService';

const DISMISS_KEY = 'TAKI_PUSH_OPTIN_DISMISSED';

export const PushOptIn: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { user, language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [state, setState] = useState<PushState | null>(null);
    const [busy, setBusy] = useState(false);
    const [dismissed, setDismissed] = useState<boolean>(() => {
        try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        let alive = true;
        pushService.status().then(s => { if (alive) setState(s); }).catch(() => {});
        return () => { alive = false; };
    }, [user?.id]);

    const enable = useCallback(async () => {
        setBusy(true);
        const next = await pushService.enable(user?.id);
        setBusy(false);
        setState(next);
        if (next === 'on') {
            await customAlert(isRTL
                ? '✅ تم تفعيل الإشعارات على هذا الجهاز. سيصلك تنبيه عند قبول طلبك وعند انطلاق المندوب وعند اقتراب انتهاء المهلة.'
                : '✅ Notifications are on for this device. You will be alerted when your order is accepted, when the courier departs, and before the window ends.');
        } else if (next === 'denied') {
            await customAlert(isRTL
                ? '🔕 الإشعارات محظورة لهذا الموقع في متصفّحك. افتح إعدادات الموقع في المتصفّح واسمح بالإشعارات، ثم أعد المحاولة.'
                : '🔕 Notifications are blocked for this site in your browser. Allow them from the browser\'s site settings, then try again.');
        } else {
            await customAlert(isRTL
                ? '⚠️ تعذّر تفعيل الإشعارات على هذا الجهاز. جرّب مجدداً، وإن تكرّر فالمتصفّح لا يدعمها هنا.'
                : '⚠️ Could not enable notifications on this device. Try again; if it repeats, this browser does not support them here.');
        }
    }, [user?.id, isRTL, customAlert]);

    const hide = useCallback(() => {
        setDismissed(true);
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    }, []);

    if (!user || !state) return null;
    if (state === 'on' || state === 'unsupported') return null;
    if (dismissed) return null;

    const ios = state === 'ios-needs-install';
    const denied = state === 'denied';

    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: compact ? '11px 13px' : '14px 16px',
            borderRadius: 16, marginBottom: 14,
            background: 'var(--card-bg)',
            border: '1.5px solid rgba(16,185,129,0.45)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
        }}>
            <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>{ios ? '📲' : denied ? '🔕' : '🔔'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                    {ios ? (isRTL ? 'فعّل الإشعارات: ثبّت تاكي أولاً' : 'Enable notifications: install TAKI first')
                        : denied ? (isRTL ? 'الإشعارات محظورة في متصفّحك' : 'Notifications are blocked in your browser')
                            : (isRTL ? 'تنبيه على جوّالك عند تحديث طلبك' : 'Get alerts on your phone about your order')}
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.7 }}>
                    {ios
                        ? (isRTL
                            ? 'الآيفون لا يوصّل إشعارات المواقع إلا للتطبيقات المثبَّتة. من سفاري: زرّ المشاركة ⬆️ ← «إضافة إلى الشاشة الرئيسية»، ثم افتح تاكي من الأيقونة وفعّلها من هنا.'
                            : 'iPhone only delivers web notifications to installed apps. In Safari: Share ⬆️ → «Add to Home Screen», then open TAKI from the icon and enable it here.')
                        : denied
                            ? (isRTL
                                ? 'لا يستطيع الموقع إعادة السؤال بعد الحظر. من شريط العنوان: أيقونة القفل 🔒 ← إعدادات الموقع ← الإشعارات ← السماح.'
                                : 'A site cannot ask again after being blocked. From the address bar: lock icon 🔒 → Site settings → Notifications → Allow.')
                            : (isRTL
                                ? 'يصلك تنبيه عند قبول التاجر لطلبك، وعند انطلاق المندوب، وقبل انتهاء مهلة الحجز — حتى والتطبيق مغلق.'
                                : 'You are alerted when the merchant accepts your order, when the courier departs, and before the booking window ends — even with the app closed.')}
                </div>
                {!ios && !denied && (
                    <button
                        onClick={enable}
                        disabled={busy}
                        style={{
                            marginTop: 10, padding: '9px 18px', borderRadius: 12, border: 'none',
                            background: busy ? 'var(--gray-400)' : 'linear-gradient(135deg,#10b981,#059669)',
                            color: '#fff', fontWeight: 900, fontSize: '0.82rem',
                            cursor: busy ? 'default' : 'pointer',
                        }}
                    >
                        {busy ? (isRTL ? 'جارٍ التفعيل…' : 'Enabling…') : (isRTL ? '🔔 تفعيل الإشعارات' : '🔔 Enable notifications')}
                    </button>
                )}
            </div>
            <button
                onClick={hide}
                aria-label={isRTL ? 'إخفاء' : 'Dismiss'}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: 'var(--gray-400)', fontSize: '1rem', fontWeight: 900, lineHeight: 1,
                }}
            >✕</button>
        </div>
    );
};

/**
 * PushToggleRow — الضابط الدائم في «حسابي ← الإشعارات».
 * البانر أعلاه يُخفى بضغطة ولا يعود؛ هذا الصفّ يبقى دائماً ويقول الحالة
 * الحقيقية لهذا الجهاز — فمن أخفى البانر أو بدّل جهازه يجد المفتاح هنا.
 */
export const PushToggleRow: React.FC = () => {
    const { user, language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [state, setState] = useState<PushState | null>(null);
    const [busy, setBusy] = useState(false);

    const reload = useCallback(() => {
        pushService.status().then(setState).catch(() => {});
    }, []);
    useEffect(reload, [reload, user?.id]);

    if (!user || !state) return null;

    const on = state === 'on';
    const blocked = state === 'denied' || state === 'ios-needs-install' || state === 'unsupported';
    const why = state === 'ios-needs-install'
        ? (isRTL ? 'ثبّت تاكي على الشاشة الرئيسية أولاً — الآيفون لا يوصّل إشعارات المواقع غير المثبَّتة.'
                 : 'Install TAKI to the Home Screen first — iPhone does not deliver web notifications to uninstalled sites.')
        : state === 'denied'
            ? (isRTL ? 'محظورة من إعدادات المتصفّح لهذا الموقع — تُفتح من أيقونة القفل 🔒 في شريط العنوان.'
                     : 'Blocked in the browser for this site — allow it from the lock icon 🔒 in the address bar.')
            : state === 'unsupported'
                ? (isRTL ? 'هذا المتصفّح لا يدعم إشعارات الجوّال.' : 'This browser does not support push notifications.')
                : on
                    ? (isRTL ? 'مفعّلة على هذا الجهاز.' : 'On for this device.')
                    : (isRTL ? 'تصلك تنبيهات طلبك حتى والتطبيق مغلق.' : 'Order alerts reach you even with the app closed.');

    const toggle = async () => {
        setBusy(true);
        if (on) { await pushService.disable(); setState('off'); }
        else {
            const next = await pushService.enable(user.id);
            setState(next);
            if (next !== 'on') {
                await customAlert(isRTL
                    ? '⚠️ لم تُفعَّل الإشعارات. تأكّد أن متصفّحك يسمح بها لهذا الموقع.'
                    : '⚠️ Notifications were not enabled. Check that your browser allows them for this site.');
            }
        }
        setBusy(false);
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px',
            borderRadius: 16, background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        }}>
            <span style={{ fontSize: '1.2rem' }}>{on ? '🔔' : '🔕'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                    {isRTL ? 'إشعارات الجوّال' : 'Push notifications'}
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.6 }}>
                    {why}
                </div>
            </div>
            {!blocked && (
                <button
                    onClick={toggle}
                    disabled={busy}
                    style={{
                        padding: '8px 16px', borderRadius: 999, border: 'none', whiteSpace: 'nowrap',
                        background: on ? 'var(--gray-100)' : 'linear-gradient(135deg,#10b981,#059669)',
                        color: on ? 'var(--text-primary)' : '#fff',
                        fontWeight: 900, fontSize: '0.78rem', cursor: busy ? 'default' : 'pointer',
                        opacity: busy ? 0.6 : 1,
                    }}
                >
                    {busy ? '…' : on ? (isRTL ? 'إيقاف' : 'Turn off') : (isRTL ? 'تفعيل' : 'Turn on')}
                </button>
            )}
        </div>
    );
};

export default PushOptIn;
