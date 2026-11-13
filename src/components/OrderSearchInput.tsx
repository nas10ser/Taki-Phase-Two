/**
 * OrderSearchInput — حقلُ البحث في الطلبات، بنصٍّ واحدٍ لكلّ الشاشات (v16.28)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (١٣ نوفمبر ٢٠٢٦): «في قائمة السجلات للطلبات — الحاليّة أو السابقة —
 * أريد علامةَ بحثٍ برقم الطلب أو الفاتورة أو الجوال أو اسم المنتج، حتى إذا جاءت
 * شكوى يعثر الجميع على الطلب والفاتورة بسرعة، للغتين».
 *
 * 🔴 ولماذا مكوّنٌ مشترَكٌ لا حقلٌ في كلّ شاشة: **النصُّ وعدٌ**. حين يقول الحقل
 *    «ابحث برقم الفاتورة» وجب أن تكون الفاتورةُ مبحوثةً فعلاً — وهي صارت كذلك
 *    في `browse_bookings` (هجرة v16.28). ونسخةٌ ثانيةٌ من النصّ تنحرف عن الأخرى
 *    عند أوّل تعديل، فيَعِد أحدُ الحقلين بما لا يفعل. مكانُ الوعد واحد.
 * 🪤 والبحثُ يجري **على الخادم** لا على الصفحة المُحمَّلة: قوائمُ الطلبات
 *    مُرقَّمة (`useBookingBrowse`)، فترشيحٌ في المتصفّح كان سيبحث في أوّل ٢٠
 *    طلباً ويقول «لا نتائج» عن طلبٍ موجود — وهو أسوأ من غياب البحث أصلاً.
 */
import React from 'react';

interface Props {
    value: string;
    onChange: (next: string) => void;
    isRTL: boolean;
    /**
     * `header` فوق شريطٍ ملوّن (حجوزاتي) · `surface` فوق بطاقةٍ عادية (لوحة التاجر).
     * 🪤 ولا يُكتب لونٌ من متغيّرات الثيم فوق الشريط الملوّن: `--text-primary`
     *    يصير أبيضَ ليلاً فيختفي النصّ على خلفيةٍ فاتحة (درس v14.64).
     */
    tone?: 'header' | 'surface';
}

/** نصُّ ما يمكن البحثُ به — مصدرٌ واحد، ويطابق فروعَ `browse_bookings`. */
export const orderSearchPlaceholder = (isRTL: boolean): string => isRTL
    ? 'ابحث برقم الطلب أو الفاتورة أو الجوّال أو المنتج…'
    : 'Search by order no., invoice, phone or product…';

/**
 * نصُّ القائمة الفارغة أثناء البحث. 🔴 لا يجوز أن تقول الشاشةُ «لا طلبات»
 * والبحثُ قائم: الطلباتُ موجودة، والبحثُ وحده لم يطابق — وفرقُ الجملتين هو
 * فرقُ «لا شيء عندك» عن «لم أجد ما تبحث عنه».
 */
export const emptyOrdersLabel = (
    searching: boolean, loading: boolean, noOrders: string, isRTL: boolean,
): string => !searching ? noOrders
    : loading ? (isRTL ? '⏳ جارٍ البحث…' : '⏳ Searching…')
    : (isRTL ? 'لا طلب يطابق بحثك' : 'No order matches your search');

export const OrderSearchInput: React.FC<Props> = ({ value, onChange, isRTL, tone = 'surface' }) => {
    const onHeader = tone === 'header';
    const fg = onHeader ? 'white' : 'var(--text-primary)';
    return (
        <div style={{
            background: onHeader ? 'rgba(100, 100, 100, 0.15)' : 'var(--card-bg)',
            backdropFilter: onHeader ? 'blur(10px)' : undefined,
            border: `1px solid ${onHeader ? 'rgba(80, 80, 95, 0.2)' : 'var(--border-color)'}`,
            borderRadius: 16, display: 'flex', alignItems: 'center',
        }}>
            <div style={{ padding: onHeader ? '0 0 0 12px' : '0 0 0 12px', color: fg, opacity: 0.8 }}>🔍</div>
            <input
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={orderSearchPlaceholder(isRTL)}
                aria-label={orderSearchPlaceholder(isRTL)}
                autoComplete="off"
                spellCheck={false}
                style={{
                    direction: isRTL ? 'rtl' : 'ltr', color: fg, flex: 1, minWidth: 0,
                    fontWeight: 600, border: 'none', background: 'transparent',
                    padding: '12px 14px', outline: 'none', fontSize: '0.9rem',
                }}
            />
            {value !== '' && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label={isRTL ? 'مسح البحث' : 'Clear search'}
                    style={{
                        background: 'transparent', border: 'none', color: fg, opacity: 0.75,
                        fontSize: '1rem', fontWeight: 900, cursor: 'pointer', padding: '10px 14px',
                    }}>✕</button>
            )}
        </div>
    );
};

export default OrderSearchInput;
