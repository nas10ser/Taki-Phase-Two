/**
 * ListSearchRow — حقلُ البحث ورسالةُ «لا نتيجة» معاً (v16.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * كلُّ شاشةٍ أضفنا إليها بحثاً تحتاج الشيئين معاً: الحقل، **ورسالةً تفرّق بين
 * «لا سجلَّ عندك» و«لم أجد ما تبحث عنه»**. وكتابتُهما في كلّ شاشةٍ على حدة
 * تُنتج عشرَ صياغاتٍ تنحرف — فجُمِعا هنا في سطرٍ واحدٍ عند كلّ منادٍ.
 */
import React from 'react';
import SearchField from './SearchField';
import type { ListSearch } from '../hooks/useListSearch';

interface Props<T> {
    search: ListSearch<T>;
    placeholder: string;
    /** نصُّ «لم أجد شيئاً» — خاصٌّ بنوع السجلّ («لا عرض يطابق بحثك»). */
    noMatch: string;
    isRTL: boolean;
    tone?: 'header' | 'surface';
}

export function ListSearchRow<T>({ search, placeholder, noMatch, isRTL, tone }: Props<T>) {
    return (
        <>
            <SearchField value={search.q} onChange={search.set} placeholder={placeholder} isRTL={isRTL} tone={tone} />
            {search.active && search.rows.length === 0 && (
                <div style={{ textAlign: 'center', padding: '34px 16px', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    🔍 {noMatch}
                </div>
            )}
        </>
    );
}

export default ListSearchRow;
