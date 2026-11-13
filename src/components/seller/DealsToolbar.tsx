/**
 * DealsToolbar — رأسُ شاشة «عروضي»: البحث + تبويبا نشطة/سابقة (v16.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * توأمُ `OrdersToolbar`: نفسُ الترتيب (الحقلُ أوّلاً — أمرُ ناصر)، ونفسُ
 * القاعدة في العدّادات: **العدّادان لا يتبعان البحث**. فلو تبعاه لقال الشريط
 * «عروض نشطة (١)» لمجرّد أن التاجر يكتب حرفاً في مربّع البحث.
 */
import React from 'react';
import SearchField from '../SearchField';

interface Props {
    tab: 'active' | 'expired';
    onTab: (t: 'active' | 'expired') => void;
    activeCount: number;
    expiredCount: number;
    query: string;
    onQuery: (q: string) => void;
    isRTL: boolean;
}

export const DealsToolbar: React.FC<Props> = ({
    tab, onTab, activeCount, expiredCount, query, onQuery, isRTL,
}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <SearchField
            value={query}
            onChange={onQuery}
            isRTL={isRTL}
            placeholder={isRTL ? 'ابحث في عروضك بالاسم أو الفئة أو الباركود…' : 'Search your deals by name, category or barcode…'}
        />
        <div style={{ display: 'flex', gap: 10, background: 'var(--card-bg)', padding: 6, borderRadius: 16, border: '1px solid var(--border-color)' }}>
            {(['active', 'expired'] as const).map(k => (
                <button
                    key={k}
                    type="button"
                    onClick={() => onTab(k)}
                    style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                        background: tab === k ? 'var(--dark)' : 'transparent',
                        color: tab === k ? 'white' : 'var(--text-secondary)',
                        fontWeight: 800, fontSize: '0.9rem', transition: 'all 0.2s', cursor: 'pointer',
                    }}>
                    {k === 'active'
                        ? `${isRTL ? 'عروض نشطة' : 'Active'} (${activeCount})`
                        : `${isRTL ? 'عروض سابقة' : 'Past'} (${expiredCount})`}
                </button>
            ))}
        </div>
    </div>
);

export default DealsToolbar;
