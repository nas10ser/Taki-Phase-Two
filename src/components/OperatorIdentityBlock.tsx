/**
 * OperatorIdentityBlock — بيانُ هويّةِ مُشغِّل المنصّة (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * سطحٌ واحدٌ يُعرض في التذييل وفي الصفحات القانونيّة السبع، مصدرُه الوحيد
 * `platform_settings.tax_settings` (يحرّره ناصر من لوحة المدير ← الزكاة
 * والضريبة) عبر `src/data/operatorIdentity.ts`.
 *
 * 🔴 **ولا يُصيَّر شيءٌ حين تنقص الهويّة** — `return null`، لا «السجل
 *    التجاري: » معلّقةً بلا قيمة. وهذا ليس تجميلاً: وثيقةٌ تَعِد بما لا
 *    يُنفَّذ أسوأُ من وثيقةٍ لا تَعِد (درس v14.82)، ولافتةٌ فارغةٌ تقول
 *    «لنا سجلٌّ» ولا تقول ما هو — فتكون أسوأَ من السكوت.
 *
 * 🪤 وسطرُ الرقم الضريبيّ **مشروطٌ بوجوده** لا بوجود البطاقة: المنصّة غيرُ
 *    مسجَّلةٍ في ضريبة القيمة المضافة (`vat_enabled=false` على جدّة)، ونشرُ
 *    رقمٍ ضريبيٍّ لمن ليس مسجَّلاً مخالفةٌ لا نقص. فيُعرض بدلاً منه إفصاحٌ
 *    صريحٌ بعدم التسجيل — في البطاقة الكاملة وحدها، لا في التذييل.
 *
 * 🪤 والألوانُ كلُّها متغيّراتُ الثيم: `--text-primary` **أبيضُ ليلاً**،
 *    فأيُّ لونٍ ثابتٍ هنا يختفي في أحد الوضعين (درس v14.64).
 */
import React from 'react';
import { useApp } from '../context/AppContext';
import { useOperatorIdentity, identityLabels } from '../data/operatorIdentity';

interface Props {
    /**
     * `card` بطاقةٌ كاملةٌ بعنوانٍ وسندٍ نظاميّ — للصفحات القانونيّة.
     * `line` سطرٌ مُدمَجٌ بلا عنوان — للتذييل، حيث البطاقةُ ضجيج.
     */
    variant?: 'card' | 'line';
}

const OperatorIdentityBlock: React.FC<Props> = ({ variant = 'card' }) => {
    const { language } = useApp();
    const id = useOperatorIdentity();
    const isRTL = language === 'ar';
    const L = identityLabels(isRTL ? 'ar' : 'en');

    // 🔴 البوّابةُ الوحيدة. وتشمل `loading` ضمناً (`complete` تبدأ `false`).
    if (!id.complete) return null;

    const rows: Array<[string, string]> = [
        [L.legalName, id.legalName],
        [L.registry, id.registryNumber],
        [L.address, id.nationalAddress],
    ];
    if (id.vatRegistered) rows.splice(2, 0, [L.vat, id.vatNumber]);

    if (variant === 'line') {
        return (
            <p
                dir={isRTL ? 'rtl' : 'ltr'}
                style={{
                    textAlign: 'center', marginTop: 12, fontSize: '0.72rem',
                    lineHeight: 1.7, color: 'var(--text-secondary)',
                }}
            >
                {rows.map(([label, value], i) => (
                    <React.Fragment key={label}>
                        {i > 0 && <span aria-hidden="true"> · </span>}
                        <span>
                            {label}: <strong style={{ fontWeight: 700 }}>{value}</strong>
                        </span>
                    </React.Fragment>
                ))}
            </p>
        );
    }

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            className="mt-4 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4"
        >
            <h3 className="text-sm font-extrabold text-[var(--text-primary)] mb-2">
                🏢 {L.heading}
            </h3>
            <dl className="space-y-1.5 text-sm">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex flex-wrap gap-x-2">
                        <dt className="font-bold text-[var(--text-secondary)]">{label}:</dt>
                        <dd className="font-extrabold text-[var(--text-primary)] break-words">{value}</dd>
                    </div>
                ))}
            </dl>
            {!id.vatRegistered && (
                <p className="mt-2 text-xs font-bold text-[var(--text-secondary)]">{L.noVat}</p>
            )}
            <p className="mt-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">{L.basis}</p>
        </div>
    );
};

export default OperatorIdentityBlock;
