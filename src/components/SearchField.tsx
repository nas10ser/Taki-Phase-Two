/**
 * SearchField — حقلُ البحث الواحد في الموقع كلِّه (v16.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «كمّل جميعها». وعشرُ شاشاتٍ تحتاج حقلَ بحث — فإمّا حقلٌ واحدٌ
 * تتشاركه كلُّها، وإمّا عشرةُ حقولٍ تنحرف هيئتُها وسلوكُها واحداً بعد آخر.
 *
 * 🔴 وما يحمله الحقلُ ليس شكلاً فقط: زرُّ المسح (بلا زرٍّ يعلق المستخدمُ على
 *    الجوّال في نتيجةٍ لا يعرف كيف يخرج منها)، و`aria-label` للقارئ الشاشيّ،
 *    و`type="search"`، وإطفاءُ التصحيح التلقائيّ (يُفسد أرقامَ الطلبات).
 * 🪤 و`tone="header"` للشريط الملوّن: لا يُكتب لونُ نصٍّ من متغيّرات الثيم
 *    فوق خلفيةٍ ثابتة — `--text-primary` يصير أبيضَ ليلاً فيختفي (درس v14.64).
 */
import React from 'react';

export interface SearchFieldProps {
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
    isRTL: boolean;
    /** `header` فوق شريطٍ ملوّن · `surface` فوق بطاقةٍ عادية (الافتراضي). */
    tone?: 'header' | 'surface';
}

export const SearchField: React.FC<SearchFieldProps> = ({
    value, onChange, placeholder, isRTL, tone = 'surface',
}) => {
    const onHeader = tone === 'header';
    const fg = onHeader ? 'white' : 'var(--text-primary)';
    return (
        <div style={{
            background: onHeader ? 'rgba(100, 100, 100, 0.15)' : 'var(--card-bg)',
            backdropFilter: onHeader ? 'blur(10px)' : undefined,
            border: `1px solid ${onHeader ? 'rgba(80, 80, 95, 0.2)' : 'var(--border-color)'}`,
            borderRadius: 16, display: 'flex', alignItems: 'center', width: '100%',
        }}>
            <div style={{ padding: '0 0 0 12px', color: fg, opacity: 0.8 }}>🔍</div>
            <input
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
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

export default SearchField;
