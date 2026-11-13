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
 * ℹ️ v16.30 — الهيئةُ والسلوك خرجا إلى `SearchField` ليتشاركهما كلُّ بحثٍ في
 *    الموقع. وبقي هنا **الوعدُ** وحده: نصُّ الطلبات ونصُّ فراغه.
 */
import React from 'react';
import SearchField from './SearchField';

interface Props {
    value: string;
    onChange: (next: string) => void;
    isRTL: boolean;
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

export const OrderSearchInput: React.FC<Props> = ({ value, onChange, isRTL, tone = 'surface' }) => (
    <SearchField
        value={value}
        onChange={onChange}
        placeholder={orderSearchPlaceholder(isRTL)}
        isRTL={isRTL}
        tone={tone}
    />
);

export default OrderSearchInput;
