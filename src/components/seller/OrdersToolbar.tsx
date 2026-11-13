/**
 * OrdersToolbar — رأسُ شاشة طلبات التاجر: التبويبان + البحث (v16.28)
 * ═══════════════════════════════════════════════════════════════════════════
 * التبويبان («نشطة» · «السجل») كانا مكتوبين داخل `SellerDashboard.tsx` وهو عند
 * سقفِ حجمه، فخروجُهما إلى هنا هو ما أتاح مكاناً للبحث — وهو تصميمٌ أصحّ كذلك:
 * رأسُ القائمة شيءٌ واحد (أين أنا + ماذا أبحث فيه)، فلا ينفصل نصفاه.
 *
 * 🔴 والبحثُ يبدّل **مصدرَ القائمة** ولا يُرشّح إحصاءاتِ اللوحة: عدّادا
 *    «نشطة/السجل» و`SellerAnalytics` يقرآن القوائمَ غيرَ المُرشَّحة كما كانا.
 *    ولولا ذلك لتبدّلت أرقامُ التاجر أمام عينه لمجرّد أنه يكتب في مربّع بحث.
 */
import React from 'react';
import OrderSearchInput, { emptyOrdersLabel } from '../OrderSearchInput';

export { emptyOrdersLabel };   // إحالةٌ لمن يستورد من هنا
import { arCount, enCount, RESULTS } from '../../utils/arPlural';

export type OrdersFilter = 'active' | 'history';

interface Props {
    filter: OrdersFilter;
    onFilter: (f: OrdersFilter) => void;
    activeCount: number;
    pastCount: number;
    query: string;
    onQuery: (q: string) => void;
    /** عددُ نتائج البحث الحاليّ — `null` حين لا بحثَ أو ما زال يُحمَّل. */
    resultCount: number | null;
    searching: boolean;
    isRTL: boolean;
}

export const OrdersToolbar: React.FC<Props> = ({
    filter, onFilter, activeCount, pastCount, query, onQuery, resultCount, searching, isRTL,
}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* التبويبان: «نشطة» للطلبات الجارية و«السجل» للمكتملة والملغاة. */}
        <div style={{ display: 'flex', gap: 8, padding: 6, background: 'var(--card-bg)', borderRadius: 16, border: '1px solid var(--border-color)' }}>
            {(['active', 'history'] as const).map(f => {
                const count = f === 'active' ? activeCount : pastCount;
                const label = f === 'active'
                    ? (isRTL ? 'نشطة' : 'Active')
                    : (isRTL ? 'السجل' : 'History');
                const selected = filter === f;
                return (
                    <button
                        key={f}
                        type="button"
                        onClick={() => onFilter(f)}
                        style={{
                            flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none',
                            background: selected ? 'var(--accent)' : 'transparent',
                            color: selected ? 'white' : 'var(--text-secondary)',
                            fontWeight: 900, fontSize: '0.85rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            cursor: 'pointer', transition: 'all 0.2s ease',
                            boxShadow: selected ? '0 6px 14px rgba(0,0,0,0.15)' : 'none',
                        }}>
                        <span>{f === 'active' ? '🔔' : '📜'}</span>
                        <span>{label}</span>
                        <span style={{
                            background: selected ? 'rgba(255,255,255,0.25)' : 'var(--gray-100)',
                            color: selected ? 'white' : 'var(--text-primary)',
                            padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 900,
                        }}>{count}</span>
                    </button>
                );
            })}
        </div>

        <OrderSearchInput value={query} onChange={onQuery} isRTL={isRTL} />

        {searching && (
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', paddingInlineStart: 6 }}>
                {/* 🪤 ولا يُصاغ المعدودُ بالأيدي: «٣ نتيجة» خطأ و«1 results» خطأ.
                    المحرّكُ واحدٌ للموقع كلّه (`arPlural`) — درسُ v14.92/93. */}
                {resultCount === null
                    ? (isRTL ? '⏳ جارٍ البحث…' : '⏳ Searching…')
                    : (isRTL
                        ? `🔍 ${arCount(resultCount, RESULTS)} في ${filter === 'active' ? 'النشطة' : 'السجل'}`
                        : `🔍 ${enCount(resultCount, 'result', 'results')} in ${filter === 'active' ? 'Active' : 'History'}`)}
            </div>
        )}
    </div>
);

export default OrdersToolbar;
