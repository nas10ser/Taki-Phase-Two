import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { isValidSaudiVat } from '../../utils/zatcaQr';
import { useVatMode } from '../../hooks/useVatMode';

/**
 * VatStatusCard — الوضع الضريبي للتاجر (v13.38)
 *
 * الثغرة التي تسدّها: حقل الرقم الضريبي كان صامتاً في «صفحتي»، فتاجر **مسجّل**
 * في الهيئة قد لا ينتبه له، فتصدر فواتير طلباته بلا ضريبة — وهذه مخالفة عليه هو،
 * ومنصتنا هي التي أصدرتها. الحل: نسأله صراحةً، ولا نلحّ عليه بعد أن يجيب.
 *
 * ثلاث حالات:
 *  • لم يحدّد بعد        → سؤال واضح (نعم/لا)
 *  • مسجّل ورقمه محفوظ   → تأكيد مختصر + إمكانية التعديل
 *  • أعلن أنه غير مسجّل  → سطر هادئ فقط (لا إزعاج)
 *
 * وعندما تُفعّل تاكي الضريبة على الاشتراكات (useVatMode.enabled) تظهر إضافةً
 * فائدة **الاسترداد**: رقمه على فاتورة اشتراكه = يخصم ضريبة مدخلاته.
 *
 * ── v13.61 — لماذا لم تعد «تظهر بعد ثوانٍ»؟ (بلاغ ناصر) ───────────────────
 * كانت البطاقة تُعيد `null` حتى تصل نتيجة الشبكة، فتفتح الصفحة بارتفاع ناقص
 * ثم **تقفز** كل البطاقات تحتها للأسفل لحظة وصول الردّ. الآن نتبع نمط
 * stale-while-revalidate الذي تستعمله التطبيقات الكبيرة:
 *   ١. آخر حالة معروفة محفوظة (ذاكرة الوحدة + localStorage) فتُرسم **فوراً**
 *      في أول إطار — بلا انتظار ولا قفزة، في كل زيارة بعد الأولى.
 *   ٢. الطلب يمضي في الخلفية، ولا نُحدّث الشاشة إلا لو اختلفت النتيجة فعلاً.
 *   ٣. في الزيارة الأولى فقط (لا كاش) نحجز مساحة البطاقة بهيكل شبحي بنفس
 *      ارتفاعها تقريباً، فلا يتحرّك شيء تحتها حين تصل البيانات.
 */

type Status = 'unknown' | 'registered' | 'not_registered';

interface Snapshot { status: Status; vatNumber: string }

// ذاكرة الوحدة: تنجو من إعادة تركيب البطاقة عند التنقّل بين تبويبات اللوحة.
const memCache = new Map<string, Snapshot>();

const lsKey = (userId: string) => `taki_vat_${userId}`;

const readCache = (userId: string): Snapshot | null => {
    const hit = memCache.get(userId);
    if (hit) return hit;
    try {
        const raw = localStorage.getItem(lsKey(userId));
        if (!raw) return null;
        const p = JSON.parse(raw) as Snapshot;
        if (p && (p.status === 'unknown' || p.status === 'registered' || p.status === 'not_registered')) {
            const snap: Snapshot = { status: p.status, vatNumber: String(p.vatNumber || '') };
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

const VatStatusCard: React.FC<{ userId: string; isRTL: boolean; onAlert: (m: string) => void }> = ({ userId, isRTL, onAlert }) => {
    const vat = useVatMode();
    const cached = readCache(userId);
    const [status, setStatus] = useState<Status>(cached?.status ?? 'unknown');
    const [vatNumber, setVatNumber] = useState(cached?.vatNumber ?? '');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    // «محسوم» = عندنا ما نرسمه الآن: إمّا كاش سابق أو ردّ وصل. لا شاشة انتظار
    // إلا في الزيارة الأولى على هذا الجهاز.
    const [settled, setSettled] = useState(!!cached);

    useEffect(() => {
        let alive = true;
        supabase.from('store_profiles').select('vat_number, vat_status').eq('store_id', userId).maybeSingle()
            .then(({ data }) => {
                if (!alive) return;
                const num = String((data as any)?.vat_number || '');
                const st = String((data as any)?.vat_status || '');
                const next: Snapshot = {
                    status: num ? 'registered' : (st === 'not_registered' ? 'not_registered' : 'unknown'),
                    vatNumber: num,
                };
                writeCache(userId, next);
                // لا نلمس الحالة إن كانت مطابقة لما هو معروض — فلا رسم زائد
                // ولا وميض على بطاقة صحيحة أصلاً.
                setVatNumber(prev => (prev === next.vatNumber ? prev : next.vatNumber));
                setStatus(prev => (prev === next.status ? prev : next.status));
                setSettled(true);
            });
        return () => { alive = false; };
    }, [userId]);

    const saveRegistered = async () => {
        const n = draft.trim();
        if (!isValidSaudiVat(n)) {
            onAlert(isRTL
                ? '⚠️ الرقم الضريبي يجب أن يكون ١٥ رقماً يبدأ وينتهي بـ٣.'
                : '⚠️ VAT number must be 15 digits starting and ending with 3.');
            return;
        }
        setSaving(true);
        // upsert لا update: التاجر الذي لم يُنشئ ملف متجره بعد لا صفّ له،
        // فـUPDATE يمسّ صفر صفوف **بصمت** ويظن أنه حفظ. (كُشف بالاختبار)
        const { error } = await supabase.from('store_profiles')
            .upsert({ store_id: userId, vat_number: n, vat_status: 'registered' }, { onConflict: 'store_id' });
        setSaving(false);
        if (error) { onAlert(isRTL ? '❌ تعذّر الحفظ، حاول مجدداً.' : '❌ Could not save.'); return; }
        setVatNumber(n); setStatus('registered'); setEditing(false);
        writeCache(userId, { status: 'registered', vatNumber: n });
        onAlert(isRTL
            ? '✅ تم الحفظ — فواتير طلباتك صارت «فاتورة ضريبية مبسطة» برمز QR.'
            : '✅ Saved — your order invoices are now simplified tax invoices with QR.');
    };

    const saveNotRegistered = async () => {
        setSaving(true);
        const { error } = await supabase.from('store_profiles')
            .upsert({ store_id: userId, vat_number: null, vat_status: 'not_registered' }, { onConflict: 'store_id' });
        setSaving(false);
        if (error) { onAlert(isRTL ? '❌ تعذّر الحفظ.' : '❌ Could not save.'); return; }
        setVatNumber(''); setStatus('not_registered');
        writeCache(userId, { status: 'not_registered', vatNumber: '' });
    };

    // الزيارة الأولى على هذا الجهاز فقط: هيكل شبحي يحجز مساحة البطاقة تقريباً،
    // فلا تقفز البطاقات تحته لحظة وصول البيانات (بلاغ ناصر — v13.61).
    if (!settled) {
        return (
            <section aria-hidden style={{
                background: 'var(--card-bg)', borderRadius: 18, padding: 18,
                border: '1px solid var(--border-color)', marginBottom: 16,
                minHeight: 250, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <div className="taki-skeleton" style={{ height: 20, width: '62%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 14, width: '100%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 14, width: '92%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 14, width: '78%', borderRadius: 8 }} />
                <div className="taki-skeleton" style={{ height: 42, width: '100%', borderRadius: 12, marginTop: 4 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                    <div className="taki-skeleton" style={{ height: 40, flex: 1, borderRadius: 12 }} />
                    <div className="taki-skeleton" style={{ height: 40, flex: 1, borderRadius: 12 }} />
                </div>
            </section>
        );
    }

    const box: React.CSSProperties = {
        background: 'var(--card-bg)', borderRadius: 18, padding: 18,
        border: '1px solid var(--border-color)', marginBottom: 16,
    };
    const btn = (bg: string): React.CSSProperties => ({
        flex: 1, padding: '11px', borderRadius: 12, border: 'none', color: 'white',
        fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', background: bg,
    });

    // ── مسجّل: تأكيد هادئ ──
    if (status === 'registered' && !editing) {
        return (
            <section style={{ ...box, borderTop: '3px solid #0d9488' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                            🧾 {isRTL ? 'مسجّل في ضريبة القيمة المضافة' : 'VAT registered'}
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 3, direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }}>
                            {vatNumber}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.7 }}>
                            {isRTL
                                ? '✅ فواتير طلباتك تصدر «فاتورة ضريبية مبسطة» برمز QR.'
                                : '✅ Your order invoices are issued as simplified tax invoices with QR.'}
                            {vat.enabled && (isRTL
                                ? ' ورقمك يظهر على فاتورة اشتراكك — فتخصم ضريبتها من إقرارك.'
                                : ' Your number also appears on your subscription invoice for input-VAT deduction.')}
                        </div>
                    </div>
                    <button onClick={() => { setDraft(vatNumber); setEditing(true); }}
                        style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 }}>
                        {isRTL ? 'تعديل' : 'Edit'}
                    </button>
                </div>
            </section>
        );
    }

    // ── غير مسجّل (أعلنها): سطر هادئ + إمكانية التغيير ──
    if (status === 'not_registered' && !editing) {
        return (
            <section style={{ ...box, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        🧾 {isRTL ? 'غير مسجّل في ضريبة القيمة المضافة — لا تُحصَّل ضريبة على طلباتك.' : 'Not VAT-registered — no VAT on your orders.'}
                    </div>
                    <button onClick={() => { setDraft(''); setEditing(true); }}
                        style={{ background: 'transparent', color: 'var(--primary)', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer', flexShrink: 0 }}>
                        {isRTL ? 'سجّلت؟ أضف رقمك' : 'Registered? Add number'}
                    </button>
                </div>
            </section>
        );
    }

    // ── لم يحدّد بعد، أو يعدّل الآن ──
    return (
        <section style={{ ...box, borderTop: '3px solid #f59e0b' }}>
            <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                🧾 {isRTL ? 'هل أنت مسجّل في ضريبة القيمة المضافة؟' : 'Are you VAT-registered?'}
            </div>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '8px 0 12px', lineHeight: 1.8 }}>
                {isRTL
                    ? 'إجابتك تحدّد شكل فواتير طلباتك: المسجّل تصدر له «فاتورة ضريبية مبسطة» برمز QR كما تشترط الهيئة، وغير المسجّل يصدر له سند طلب بلا ضريبة.'
                    : 'This determines your order invoices: registered merchants get simplified tax invoices with a ZATCA QR; unregistered get a plain receipt.'}
                {vat.enabled && (isRTL
                    ? ` وإذا كنت مسجّلاً، يظهر رقمك على فاتورة اشتراكك فتخصم ضريبتها (${vat.rate}٪) من إقرارك.`
                    : ` If registered, your number appears on your subscription invoice so you can deduct its VAT (${vat.rate}%).`)}
            </div>

            <input
                value={draft}
                onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 15))}
                inputMode="numeric"
                placeholder="3XXXXXXXXXXXXXX3"
                style={{
                    width: '100%', padding: '11px 14px', borderRadius: 12, fontSize: '16px',
                    border: '1px solid var(--border-color)', background: 'var(--body-bg)',
                    color: 'var(--text-primary)', outline: 'none', direction: 'ltr', marginBottom: 6,
                }}
            />
            {draft && !isValidSaudiVat(draft) && (
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--danger)', marginBottom: 8 }}>
                    ⚠️ {isRTL ? '١٥ رقماً يبدأ وينتهي بـ٣' : '15 digits, starts and ends with 3'}
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={saveRegistered} disabled={saving || !draft}
                    style={{ ...btn('linear-gradient(135deg,#0d9488,#0f766e)'), opacity: saving || !draft ? 0.5 : 1 }}>
                    {saving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? '✅ نعم — احفظ رقمي' : '✅ Yes — save')}
                </button>
                <button onClick={saveNotRegistered} disabled={saving}
                    style={{ ...btn('var(--gray-400)'), opacity: saving ? 0.5 : 1 }}>
                    {isRTL ? 'لا، لست مسجّلاً' : 'No, not registered'}
                </button>
            </div>
            {editing && (
                <button onClick={() => setEditing(false)}
                    style={{ width: '100%', marginTop: 8, background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer' }}>
                    {isRTL ? 'إلغاء' : 'Cancel'}
                </button>
            )}
        </section>
    );
};

export default VatStatusCard;
