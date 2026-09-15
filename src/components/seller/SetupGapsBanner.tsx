/**
 * SetupGapsBanner — لافتة نواقص إعداد المتجر (v14.45)
 * ═══════════════════════════════════════════════════════════════════════════
 * قِيس على الإنتاج (١٥ سبتمبر ٢٠٢٦): ثلاثة متاجر من ثلاثة بلا سياسة استرداد،
 * فصفحة كل عرضٍ لها تقول للمشتري «لم يُعلن هذا المتجر سياسة استرداد» قبل زرّ
 * الحجز؛ ومتجرٌ لم يُقرّ طريقة حسابه فعروضه تبقى مسوّدات ولا يعرف هو لماذا.
 *
 * قرار ناصر قائم: **لا إلزام**. فالمطلوب أن يكون التركُ مكلفاً وواضحاً لا
 * ممنوعاً. ولذلك:
 *   • اللافتة **بلا زرّ إغلاق** — تختفي وحدها حين يُكمل التاجر، لا قبل.
 *   • تقول أثر النقص لا اسمه: «عروضك تبقى مسوّدات»، «المشتري يقرأ الآن…».
 *   • زرٌّ واحد ينقله إلى البطاقة التي تُصلحها.
 *
 * ومصدرها هو نفسه مصدر التذكير الأسبوعي (`merchant_setup_gaps` في القاعدة)،
 * فلا تفترق شاشةٌ عن إشعار.
 *
 * 🪤 لا تُرسم `null` حتى يصل الردّ (درس v13.61): ذلك يقفز بكل ما تحتها. نقرأ
 * آخر حالة معروفة من التخزين المحلي فنرسمها فوراً، ولا نلمس الشاشة بعدها إلا
 * إن اختلفت النتيجة فعلاً.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface Gaps {
    refundMissing: boolean;
    payUndeclared: boolean;
}

/** تُطلقه البطاقة التي تسدّ النقص بعد حفظٍ ناجح. */
export const SETUP_GAPS_CHANGED = 'taki:setup-gaps-changed';
export const notifySetupGapsChanged = () => {
    try { window.dispatchEvent(new Event(SETUP_GAPS_CHANGED)); } catch { /* بيئة بلا window */ }
};

const lsKey = (userId: string) => `taki_setupgaps_${userId}`;
const memCache = new Map<string, Gaps>();

const parse = (raw: unknown): Gaps | null => {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    if (typeof d.refund_policy_missing !== 'boolean' && typeof d.payment_undeclared !== 'boolean') return null;
    return { refundMissing: d.refund_policy_missing === true, payUndeclared: d.payment_undeclared === true };
};

const readCache = (userId: string): Gaps | null => {
    const hit = memCache.get(userId);
    if (hit) return hit;
    try {
        const raw = localStorage.getItem(lsKey(userId));
        if (!raw) return null;
        const p = JSON.parse(raw) as Gaps;
        if (p && typeof p.refundMissing === 'boolean' && typeof p.payUndeclared === 'boolean') {
            memCache.set(userId, p);
            return p;
        }
    } catch { /* وضع خاص أو تخزين ممتلئ — نكمل بلا كاش */ }
    return null;
};

const writeCache = (userId: string, g: Gaps) => {
    memCache.set(userId, g);
    try { localStorage.setItem(lsKey(userId), JSON.stringify(g)); } catch { /* تجاهل */ }
};

const SetupGapsBanner: React.FC<{ userId: string; isRTL: boolean; onFix: () => void }> = ({ userId, isRTL, onFix }) => {
    const [gaps, setGaps] = useState<Gaps | null>(() => readCache(userId));

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc('my_setup_gaps');
        // فشلٌ عابر لا يعني «لا نواقص»: نُبقي آخر حالة معروفة كما هي.
        if (error) return;
        const next = parse(data);
        if (!next) return;
        writeCache(userId, next);
        setGaps(prev => (prev && prev.refundMissing === next.refundMissing && prev.payUndeclared === next.payUndeclared) ? prev : next);
    }, [userId]);

    // البطاقتان اللتان تُصلحان النقص تُطلقان هذا الحدث بعد حفظٍ ناجح، فتختفي
    // اللافتة فوراً بلا إعادة تحميل الصفحة وبلا تمرير خصائص عبر اللوحة كلها.
    useEffect(() => {
        load();
        const onChanged = () => { load(); };
        window.addEventListener(SETUP_GAPS_CHANGED, onChanged);
        return () => window.removeEventListener(SETUP_GAPS_CHANGED, onChanged);
    }, [load]);

    if (!gaps || (!gaps.refundMissing && !gaps.payUndeclared)) return null;

    const items: string[] = [];
    if (gaps.payUndeclared) {
        items.push(isRTL
            ? 'لم تُقرّ طريقة الحساب — وعروضك تبقى مسوّدات لا يراها أحد حتى تُقرّها.'
            : 'You have not declared how you get paid — your deals stay drafts until you do.');
    }
    if (gaps.refundMissing) {
        items.push(isRTL
            ? 'لم تكتب سياسة الاسترداد — وصفحة كل عرضٍ لك تقول للمشتري الآن: «لم يُعلن هذا المتجر سياسة استرداد».'
            : 'No refund policy — every deal page of yours now tells buyers: “this store has not published a refund policy”.');
    }

    return (
        <div
            role="status"
            style={{
                marginBottom: 16, padding: '14px 16px', borderRadius: 16,
                border: '1.5px solid rgba(245,158,11,0.45)',
                background: 'rgba(245,158,11,0.10)',
                display: 'flex', flexDirection: 'column', gap: 10,
                textAlign: isRTL ? 'right' : 'left',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.15rem' }}>📋</span>
                <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    {isRTL ? 'ينقص متجرك إعدادٌ يراه عملاؤك' : 'Your store setup is incomplete'}
                </span>
            </div>
            <ul style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(t => (
                    <li key={t} style={{ fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.8, color: 'var(--text-secondary)' }}>{t}</li>
                ))}
            </ul>
            <button
                type="button"
                onClick={onFix}
                style={{
                    alignSelf: isRTL ? 'flex-start' : 'flex-end',
                    padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: '#b45309', color: '#fff', fontWeight: 900, fontSize: '0.78rem',
                    fontFamily: 'inherit',
                }}
            >
                {isRTL ? '← أكمِل الآن' : 'Complete now →'}
            </button>
        </div>
    );
};

export default SetupGapsBanner;
