import React from 'react';
import { AdmCard, AdmButton, AdmNumber, admCount, DAYS } from './ui';

/**
 * AnalystPeriodBar — فترةُ تحليل «المحلل الذكي» في مكانٍ واحد (v16.36)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٧ نوفمبر ٢٠٢٦): «في التحليلات النمو دائما ما وجدت تحليلات
 *    شهريه و٣ شهور ولا يوجد مرونه في تحديد عدد الايام مثلا اليوم او اسبوع او
 *    عدد الايام التي اريدها». وكانت الاختصاراتُ ثلاثةً فقط: ٧ · ٣٠ · ٩٠.
 *    ⇒ صارت خمسةً (اليوم · يومان · أسبوع · شهر · ٣ شهور) **ومعها حقلٌ حرّ**.
 *
 * 🪤 وخرجت إلى ملفّها لأن `AdminAnalyst.tsx` ملفٌّ **مُعلَنٌ ضخماً** في
 *    `scripts/file-size-ledger.json` (١٥٩١ سطراً) والسقّافةُ تمنع نموَّه —
 *    وقد أوقفت البناءَ فعلاً عند ١٦١٥. وقاعدةُ المشروع: **قلّص، لا ترفع السقف**.
 *
 * 🪤 و`commitOnly` على الحقل الحرّ ليس تجميلاً: تغييرُ الفترة يُعيد جلبَ كلّ
 *    أقسام المحلل، فبلا هذا تُجلب التحليلاتُ عند «٣» ثمّ عند «٣٠» — نصفُها
 *    لرقمٍ لم يقصده أحد، على قاعدةٍ بنواةٍ واحدة.
 *
 * 🪤 والصياغةُ `admCount(d, DAYS)` لا `${d} يوماً`: الأخيرةُ تكتب «1 يوماً»
 *    و«٧ يوماً» وكلاهما خطأٌ عربيّ، و`scripts/check-ar-plural.js` يحرس هذا.
 */
const PRESETS = [1, 2, 7, 30, 90];

export const AnalystPeriodBar: React.FC<{
    days: number;
    onPick: (d: number) => void;
    onRefresh: () => void;
}> = ({ days, onPick, onRefresh }) => (
    <AdmCard>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>فترة التحليل</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {PRESETS.map((d) => (
                    <button
                        key={d} type="button" aria-pressed={days === d} className="adm-focusable"
                        onClick={() => onPick(d)}
                        style={{
                            padding: '6px 13px', fontSize: '.78rem', fontWeight: 800, borderRadius: 999, cursor: 'pointer',
                            border: `1px solid ${days === d ? 'transparent' : 'var(--adm-border)'}`,
                            background: days === d ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
                            color: days === d ? '#ffffff' : 'var(--adm-fg-2)',
                        }}
                    >
                        {admCount(d, DAYS)}
                    </button>
                ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>أو آخر</span>
                <AdmNumber
                    value={days} min={1} max={3650} commitOnly
                    onChange={onPick}
                    aria-label="عدد أيام فترة التحليل"
                    className="adm-focusable"
                    style={{
                        width: 78, padding: '6px 9px', fontSize: '.8rem', fontWeight: 800, textAlign: 'center',
                        borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                        background: 'var(--adm-surface)', color: 'var(--adm-fg)',
                    }}
                />
                <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>يوماً</span>
            </label>
            <span style={{ flex: 1 }} />
            <AdmButton onClick={onRefresh} size="sm" title="إعادة جلب كل الأقسام">🔄 تحديث</AdmButton>
        </div>
        <p style={{ fontSize: '.72rem', lineHeight: 1.8, color: 'var(--adm-fg-3)', marginTop: 9 }}>
            تسري على كل الأقسام، وتُزامِن تواريخ «المحلل المخصّص» معها — فلا يتعارض رقمان.
        </p>
    </AdmCard>
);

export default AnalystPeriodBar;
