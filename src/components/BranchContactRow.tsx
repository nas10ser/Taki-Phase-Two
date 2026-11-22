/**
 * BranchContactRow — «اتصل بالفرع» داخل الطلب (v16.52)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «وتأكّد من أن الخيار متاحٌ حتى عند حجز المشتري الطلبَ لنفس الفرع».
 *
 * 🔴 والرقمُ يُقرأ حيّاً من `store_branches` لا من صفّ الحجز: الطلبُ قد يبقى
 *    أياماً، والتاجرُ قد يغيّر رقمَ فرعه بينها — ورقمٌ مجمَّدٌ في الطلب يعني
 *    مشترياً يتّصل برقمٍ ميّت ويظنّ المتجرَ لا يردّ.
 *
 * 🪤 ويرتدّ إلى رقم المتجر الموحّد: تاجرٌ له عشرون فرعاً برقمٍ واحدٍ لا يكتبه
 *    عشرين مرّة — فالفراغُ هنا «استعمل الموحّد»، لا «بلا تواصل».
 *
 * 🪤 ولا يُعرض زرُّ واتساب إلّا حين يُشتقّ رقمٌ صالح: رابطٌ معطوبٌ يفتح واتساب
 *    ويقول «الرقم غير صالح»، فيستنتج المشتري أن المتجر ليس على واتساب — وهو
 *    عيبٌ لا يُسجَّل في أيّ سجلّ (درس v14.77).
 */
import React from 'react';
import { waLink } from '../utils/helpers';
import { toLatinDigits } from '../../shared/phone';

export const BranchContactRow: React.FC<{
    /** رقمُ الفرع إن وُجد. */
    branchPhone?: string | null;
    /** رقمُ المتجر الموحّد — ما يرتدّ إليه. */
    storePhone?: string | null;
    /** اسمُ الفرع، لتُقال للمشتري جهةُ الاتصال لا رقمٌ صامت. */
    branchName?: string | null;
    isRTL: boolean;
    /**
     * `row` صفٌّ ضيّقٌ داخل بطاقة الطلب · `card` بطاقةٌ عريضةٌ بزرّين
     * متساويين في صفحة العرض · `inline` زرّان صغيران بلا غلافٍ، يُصفّان
     * بجانب «الاتجاهات» في صفّ الموقع.
     * والثلاثةُ **مكوّنٌ واحد** عمداً: الارتدادُ وتطبيعُ `tel:` وشرطُ
     * صلاحيّة رابط واتساب منطقٌ واحد، وثلاثُ نسخٍ منه تنحرف.
     */
    variant?: 'row' | 'card' | 'inline';
}> = ({ branchPhone, storePhone, branchName, isRTL, variant = 'row' }) => {
    const own = String(branchPhone || '').trim();
    const phone = own || String(storePhone || '').trim();
    if (!phone) return null;

    const tel = toLatinDigits(phone).replace(/[^\d+]/g, '');
    const wa = waLink(phone);
    const title = own && branchName
        ? (isRTL ? `📍 ${branchName}` : `📍 ${branchName}`)
        : (isRTL ? '📞 تواصل مع المتجر' : '📞 Contact the store');

    if (variant === 'inline') {
        return (
            <>
                <a href={`tel:${tel}`}
                   aria-label={isRTL ? `اتصل بـ${branchName || 'الفرع'}` : `Call ${branchName || 'branch'}`}
                   style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 10, padding: '7px 12px', fontSize: '0.75rem', fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    📞 {isRTL ? 'اتصال' : 'Call'}
                </a>
                {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer"
                       aria-label={isRTL ? `واتساب ${branchName || 'الفرع'}` : `WhatsApp ${branchName || 'branch'}`}
                       style={{ background: 'rgba(37,211,102,0.14)', border: '1px solid rgba(37,211,102,0.5)', color: '#128C7E', borderRadius: 10, padding: '7px 12px', fontSize: '0.75rem', fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        💬 {isRTL ? 'واتساب' : 'WhatsApp'}
                    </a>
                )}
            </>
        );
    }

    if (variant === 'card') {
        return (
            <div className="animate-fade-in" style={{
                background: 'var(--card-bg)', borderRadius: 20, padding: 16, marginBottom: 12,
                boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
            }}>
                {own && branchName && (
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        📍 {isRTL ? `تواصل مع ${branchName}` : `Contact ${branchName}`}
                    </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                    <a href={`tel:${tel}`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--body-bg)', padding: '12px', borderRadius: 14, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 800, border: '1.5px solid var(--gray-200)' }}>
                        📞 {isRTL ? 'اتصال' : 'Call'}
                    </a>
                    {wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer"
                           style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#25d366', padding: '12px', borderRadius: 14, color: 'white', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 800 }}>
                            💬 WhatsApp
                        </a>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{
            background: 'var(--body-bg)', borderRadius: 14, padding: '10px 12px',
            marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', flex: 1, minWidth: 120 }}>
                {title}
            </span>
            <a href={`tel:${tel}`}
               aria-label={isRTL ? 'اتصال' : 'Call'}
               style={{
                   background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                   color: 'var(--text-primary)', borderRadius: 10, padding: '7px 12px',
                   fontSize: '0.75rem', fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
               }}>
                📞 {isRTL ? 'اتصال' : 'Call'}
            </a>
            {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer"
                   aria-label={isRTL ? 'واتساب' : 'WhatsApp'}
                   style={{
                       background: 'rgba(37,211,102,0.14)', border: '1px solid rgba(37,211,102,0.5)',
                       color: '#128C7E', borderRadius: 10, padding: '7px 12px',
                       fontSize: '0.75rem', fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
                   }}>
                    💬 {isRTL ? 'واتساب' : 'WhatsApp'}
                </a>
            )}
        </div>
    );
};

export default BranchContactRow;
