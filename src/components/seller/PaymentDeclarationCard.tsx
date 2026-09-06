import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';

/**
 * PaymentDeclarationCard — إقرار التاجر بطريقة الحساب (v14.08)
 *
 * ── الثغرة التي تسدّها (بلاغ ناصر) ────────────────────────────────────────
 * «يوجد متجر لم يضع طريقة الحساب وأستطيع الحجز». متجرٌ لم يُعلن كيف يقبض ثمن
 * طلباته يترك المشتري يحجز ثم يكتشف عند الباب أن لا أحد يعرف كيف يُدفع الثمن.
 * القاعدة صارت ترفض ذلك من جذره (حارس الحجز يرمي `TAKI_STORE_NO_PAYMENT`)،
 * لكن الرفض وحده ليس حلاً: التاجر يجب أن **يُسأل صراحةً** قبل أن يخسر طلباً،
 * لا أن يكتشف الحظر من شكوى مشترٍ.
 *
 * ── لماذا سؤال واحد لا نموذج إعدادات؟ ────────────────────────────────────
 * لأن الجواب ثنائي فعلاً: إمّا يقبل النقد عند الاستلام، وإمّا لا يقبله فيبيع
 * بالبطاقة وحدها. والحالة الثانية تستلزم بوابة دفع مفعّلة — وإلا فهو متجر لا
 * يستطيع تحصيل ريال واحد؛ لذلك القاعدة ترفضها بـ`NEED_GATEWAY_OR_COD`
 * ونترجمها هنا إلى طريق واضح: «فعّل بوابة الدفع أولاً».
 *
 * ── لماذا كاش قبل الرسم؟ (درس v13.61) ────────────────────────────────────
 * البطاقة تقف في **أعلى** تبويب الإضافة. لو رُسمت `null` حتى وصول الشبكة
 * لقفز كل ما تحتها للأسفل عند وصول الردّ. فنرسم آخر حالة معروفة فوراً
 * (ذاكرة الوحدة + localStorage)، ونحجز مساحة بهيكل شبحي في الزيارة الأولى
 * وحدها، ثم لا نلمس الشاشة إلا إن اختلفت النتيجة فعلاً.
 */

interface Snapshot {
    ok: boolean;
    reason?: 'not_declared' | 'no_method';
    acceptsCod: boolean;
    /** بوابة الدفع مفعّلة ومختبرة (يحسبها الخادم من وضع طرق الدفع). */
    online: boolean;
}

// ذاكرة الوحدة: تنجو من إعادة تركيب البطاقة عند التنقّل بين تبويبات اللوحة.
const memCache = new Map<string, Snapshot>();
const lsKey = (userId: string) => `taki_paydecl_${userId}`;

const parseSnapshot = (raw: unknown): Snapshot | null => {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    if (typeof d.ok !== 'boolean') return null;
    const reason = d.reason === 'not_declared' || d.reason === 'no_method' ? d.reason : undefined;
    return { ok: d.ok, reason, acceptsCod: d.accepts_cod !== false, online: d.online === true };
};

const readCache = (userId: string): Snapshot | null => {
    const hit = memCache.get(userId);
    if (hit) return hit;
    try {
        const raw = localStorage.getItem(lsKey(userId));
        if (!raw) return null;
        const p = JSON.parse(raw) as Snapshot;
        if (p && typeof p.ok === 'boolean') {
            const snap: Snapshot = { ok: p.ok, reason: p.reason, acceptsCod: p.acceptsCod !== false, online: p.online === true };
            memCache.set(userId, snap);
            return snap;
        }
    } catch { /* وضع خاص أو تخزين ممتلئ — نكمل بلا كاش */ }
    return null;
};

const writeCache = (userId: string, snap: Snapshot) => {
    memCache.set(userId, snap);
    try { localStorage.setItem(lsKey(userId), JSON.stringify(snap)); } catch { /* تجاهل */ }
};

/** رموز القاعدة لا يقرؤها تاجر — كل رمز يصير جملةً تقول ماذا يفعل الآن. */
const errText = (e: unknown, isRTL: boolean): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    if (raw.includes('NEED_GATEWAY_OR_COD')) {
        return isRTL
            ? 'البطاقة فقط تتطلّب تفعيل بوابة الدفع أولاً من بطاقة «بوابة الدفع» أسفل هذه البطاقة.'
            : 'Card-only requires an active payment gateway first — set it up in the “Payment gateway” card below.';
    }
    if (raw.includes('SELLER_ONLY')) {
        return isRTL ? 'هذه الخاصية لحسابات المتاجر فقط.' : 'This feature is for store accounts only.';
    }
    if (raw.includes('AUTH_REQUIRED')) {
        return isRTL ? 'انتهت جلستك — أعد تسجيل الدخول ثم حاول مجدداً.' : 'Your session expired — sign in again and retry.';
    }
    return raw || (isRTL ? 'خطأ غير معروف' : 'Unknown error');
};

const PaymentDeclarationCard: React.FC<{ userId: string; isRTL: boolean; onAlert: (m: string) => void }> = ({ userId, isRTL, onAlert }) => {
    const { darkMode } = useApp();
    const cached = readCache(userId);
    const [snap, setSnap] = useState<Snapshot | null>(cached);
    const [settled, setSettled] = useState(!!cached);
    const [saving, setSaving] = useState<'cod' | 'card' | null>(null);
    const [editing, setEditing] = useState(false);
    // فشل القراءة بلا كاش: لا نُخفي البطاقة بصمت — إخفاء شرطٍ يمنع كل الحجوزات
    // أسوأ من سطر يقول «تعذّر التحقق». ولا نصرخ تحذيراً كاذباً على انقطاع شبكة.
    const [failed, setFailed] = useState(false);

    // درجتان لكل لون دلالي — ثابتُ اللون يختفي على خلفية الوضع الليلي.
    const warn = darkMode ? '#fbbf24' : '#b45309';
    const good = darkMode ? '#34d399' : '#059669';

    // البطاقة قد تُفكَّك أثناء الطلب (تبديل تبويب) — فنحرس كل setState بعده.
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc('store_can_sell', { p_store_id: userId });
        if (!alive.current) return;
        const next = error ? null : parseSnapshot(data);
        if (next) {
            writeCache(userId, next);
            // لا نلمس الحالة إن كانت مطابقة لما هو معروض — فلا وميض على بطاقة صحيحة.
            setSnap(prev => (prev && prev.ok === next.ok && prev.reason === next.reason
                && prev.acceptsCod === next.acceptsCod && prev.online === next.online) ? prev : next);
        }
        setFailed(!next);
        setSettled(true);
    }, [userId]);

    useEffect(() => { void load(); }, [load]);

    const declare = async (acceptsCod: boolean) => {
        if (saving) return;
        setSaving(acceptsCod ? 'cod' : 'card');
        try {
            const { data, error } = await supabase.rpc('merchant_set_payment_declaration', { p_accepts_cod: acceptsCod });
            if (error) throw error;
            const next = parseSnapshot(data);
            // ردّ بلا شكل معروف = لا نُعلن نجاحاً كاذباً؛ نعيد القراءة من المصدر.
            if (!next) { await load(); throw new Error(isRTL ? 'ردّ غير متوقّع من الخادم' : 'Unexpected server response'); }
            writeCache(userId, next);
            if (alive.current) { setSnap(next); setEditing(false); }
            onAlert(acceptsCod
                ? (isRTL ? '✅ تم الحفظ — متجرك يقبل الدفع عند الاستلام، والحجز مفتوح لعملائك.' : '✅ Saved — your store accepts cash on delivery and bookings are open.')
                : (isRTL ? '✅ تم الحفظ — متجرك يبيع بالبطاقة فقط، ولن يُقبل أي طلب نقدي.' : '✅ Saved — card-only; cash orders will be rejected.'));
        } catch (e) {
            onAlert(`❌ ${errText(e, isRTL)}`);
        } finally {
            if (alive.current) setSaving(null);
        }
    };

    const box: React.CSSProperties = {
        background: 'var(--card-bg)', borderRadius: 18, padding: 18,
        border: '1px solid var(--border-color)',
    };

    // الزيارة الأولى على هذا الجهاز وحدها: هيكل شبحي يحجز المساحة فلا تقفز
    // البطاقات تحته لحظة وصول البيانات.
    if (!settled) {
        return (
            <section aria-hidden style={{ ...box, minHeight: 150, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="taki-skeleton" style={{ height: 20, width: '68%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 14, width: '100%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 14, width: '84%', borderRadius: 8 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <div className="taki-skeleton" style={{ height: 44, flex: 1, borderRadius: 12 }} />
                    <div className="taki-skeleton" style={{ height: 44, flex: 1, borderRadius: 12 }} />
                </div>
            </section>
        );
    }

    // تعذّرت القراءة ولا كاش: سطر محايد بإعادة محاولة — لا تحذير كاذب ولا صمت.
    if (!snap) {
        if (!failed) return null;
        return (
            <section style={{ ...box, padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', minWidth: 0 }}>
                    {isRTL ? 'تعذّر التحقق من طريقة الحساب — تحقّق من اتصالك.' : 'Could not check your payment declaration — check your connection.'}
                </div>
                <button
                    type="button"
                    onClick={() => { setSettled(false); setFailed(false); void load(); }}
                    style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: '0.76rem', fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}
                >
                    {isRTL ? 'إعادة المحاولة' : 'Retry'}
                </button>
            </section>
        );
    }

    const choiceButtons = (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
                type="button"
                onClick={() => declare(true)}
                disabled={saving !== null}
                style={{
                    flex: 1, minWidth: 150, padding: '13px', borderRadius: 14, border: 'none',
                    background: 'linear-gradient(135deg,#059669,#047857)', color: '#fff',
                    fontWeight: 900, fontSize: '0.86rem', fontFamily: 'inherit',
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
            >
                {saving === 'cod'
                    ? (isRTL ? '⏳ جاري الحفظ…' : '⏳ Saving…')
                    : (isRTL ? '💵 أقبل الدفع عند الاستلام' : '💵 I accept cash on delivery')}
            </button>
            <button
                type="button"
                onClick={() => declare(false)}
                disabled={saving !== null}
                style={{
                    flex: 1, minWidth: 150, padding: '13px', borderRadius: 14,
                    border: '1.5px solid var(--primary)', background: 'transparent', color: 'var(--primary)',
                    fontWeight: 900, fontSize: '0.86rem', fontFamily: 'inherit',
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
            >
                {saving === 'card'
                    ? (isRTL ? '⏳ جاري الحفظ…' : '⏳ Saving…')
                    : (isRTL ? '💳 بطاقة فقط' : '💳 Card only')}
            </button>
        </div>
    );

    // ── لم يُقرّ بعد (أو أقرّ بما لا يُحصِّل شيئاً): بطاقة تحذيرية بارزة ──
    if (!snap.ok) {
        const noMethod = snap.reason === 'no_method';
        return (
            <section style={{
                ...box,
                background: darkMode ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.08)',
                // ⚠️ الاختصار `border` يمسح `borderTop` إن جاء بعده في نفس الكائن —
                //    فالشريط العلوي يُكتب **بعده** لا قبله وإلا اختفى بصمت.
                border: '1.5px solid rgba(245,158,11,0.45)',
                borderTop: `3px solid ${warn}`,
            }}>
                <div style={{ fontWeight: 900, fontSize: '0.98rem', color: warn, lineHeight: 1.6 }}>
                    ⚠️ {isRTL
                        ? 'متجرك لا يستقبل حجوزات حتى تحدّد كيف تُحاسِب عملاءك'
                        : 'Your store cannot take bookings until you declare how you get paid'}
                </div>
                <p style={{ margin: '8px 0 14px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                    {noMethod
                        ? (isRTL
                            ? 'أنت رافضٌ للدفع عند الاستلام وليس لديك بوابة دفع مفعّلة — فلا وسيلة لتحصيل ثمن أي طلب. اقبل الدفع عند الاستلام، أو فعّل بوابة الدفع من بطاقة «بوابة الدفع» أسفل هذه البطاقة.'
                            : 'You declined cash on delivery and have no active gateway — so there is no way to collect payment. Either accept cash on delivery, or activate your gateway in the “Payment gateway” card below.')
                        : (isRTL
                            ? 'المشتري يسأل قبل أن يحجز: كيف أدفع؟ اختر إجابتك مرّة واحدة وتُفتح الحجوزات فوراً. يمكنك تغييرها متى شئت.'
                            : 'Buyers ask one thing before booking: how do I pay? Answer once and bookings open immediately. You can change it any time.')}
                </p>
                {choiceButtons}
            </section>
        );
    }

    // ── أقرّ فعلاً: سطر مصغّر يعرض الحالة، والتغيير بضغطة ──
    const current = snap.acceptsCod
        ? (snap.online
            ? (isRTL ? 'الدفع عند الاستلام + البطاقة' : 'Cash on delivery + card')
            : (isRTL ? 'الدفع عند الاستلام' : 'Cash on delivery'))
        : (isRTL ? 'البطاقة فقط' : 'Card only');

    return (
        <section style={{ ...box, padding: editing ? 18 : '13px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                        {snap.acceptsCod ? '💵' : '💳'} {isRTL ? 'طريقة الحساب:' : 'Payment method:'}{' '}
                        <span style={{ color: good }}>{current}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 3 }}>
                        {isRTL ? '✅ متجرك يستقبل الحجوزات.' : '✅ Your store is accepting bookings.'}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setEditing(v => !v)}
                    style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: '0.76rem', fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}
                >
                    {editing ? (isRTL ? 'إغلاق' : 'Close') : (isRTL ? 'تغيير' : 'Change')}
                </button>
            </div>
            {editing && <div style={{ marginTop: 14 }}>{choiceButtons}</div>}
        </section>
    );
};

export default PaymentDeclarationCard;
