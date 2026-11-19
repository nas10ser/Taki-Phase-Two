import React, { useMemo, useState } from 'react';
import { AdmNumber } from './ui';
import { computeBannerSchedule, scheduleModeOf, MAX_SCHEDULE_DAYS } from './bannerScheduleRule';
import type { BannerScheduleMode } from './bannerScheduleRule';

/**
 * BannerSchedule — متى يظهر البانر ومتى يختفي (v16.46)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «تاريخٌ محدَّد من وإلى والساعة، أو تحطّ
 *    أياماً ويُحسب بالدقيقة — أسبوع أو أسبوعان أو شهر أو أيّ عددٍ أضعه —
 *    أو تعطيني خيار أجعلها مفتوحة».
 *
 * 🪤 ومكوّنٌ مستقلٌّ لا كتلةٌ داخل `AdminTools.tsx`: ذاك ملفٌّ مُعلَنٌ ضخماً
 *    (١٥٦٩ سطراً) ولا يُسمح له أن ينمو — والقاعدة **قلّص، لا ترفع السقف**.
 * 🪤 والحسابُ كلُّه في `bannerScheduleRule.ts` (خالصٌ ومُختبَرٌ بالتنفيذ)،
 *    وهذا الملفُّ شاشةٌ فقط: لا قاعدةَ تُكتب هنا فتنحرف عن الأخرى.
 */
export const BannerSchedule: React.FC<{
    /** الصفُّ عند التعديل — لفتح المحرّر على وضعه الصحيح. */
    initial?: { starts_at?: string | null; expires_at?: string | null } | null;
    /** يُستدعى عند كلّ تغيير بالقيم الجاهزة للحفظ (أو بخطأٍ يمنعه). */
    onChange: (v: { starts_at: string | null; expires_at: string | null; error: string | null }) => void;
}> = ({ initial, onChange }) => {
    const [mode, setMode] = useState<BannerScheduleMode>(() => scheduleModeOf(initial));
    const [days, setDays] = useState(7);
    // 🪤 حقلُ `datetime-local` لا يقبل `Z`: يُقصّ الـISO إلى `YYYY-MM-DDTHH:mm`
    //    **بتوقيت الجهاز** لا بـUTC، وإلّا ظهرت الساعةُ مزحزحةً ثلاثَ ساعات.
    const toLocal = (iso?: string | null) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return '';
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const [from, setFrom] = useState(() => toLocal(initial?.starts_at));
    const [to, setTo] = useState(() => toLocal(initial?.expires_at));

    const result = useMemo(
        () => computeBannerSchedule({ mode, days, from, to }, Date.now()),
        [mode, days, from, to],
    );

    // يُبلَّغ الأبُ بكلّ تغيير — ومعه الخطأُ إن وُجد، فيمنع الحفظ عنده.
    React.useEffect(() => {
        onChange({ starts_at: result.startsAt, expires_at: result.expiresAt, error: result.error });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result.startsAt, result.expiresAt, result.error]);

    const chip = (active: boolean): React.CSSProperties => ({
        padding: '7px 13px', borderRadius: 999, cursor: 'pointer', fontSize: '.76rem', fontWeight: 800,
        border: `1px solid ${active ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
        background: active ? 'var(--adm-info-bg)' : 'var(--adm-surface-2)',
        color: active ? 'var(--adm-accent)' : 'var(--adm-fg-2)',
    });
    const field: React.CSSProperties = {
        padding: '9px 10px', fontSize: '.82rem', fontWeight: 700, width: '100%',
        borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
        background: 'var(--adm-surface)', color: 'var(--adm-fg)',
    };

    return (
        <div style={{ border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ fontSize: '.82rem', fontWeight: 900, color: 'var(--adm-fg)' }}>🗓 مدّةُ ظهور البانر</div>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {([['open', 'مفتوحة'], ['days', 'عدد أيام'], ['range', 'من / إلى بالساعة']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                        className="adm-focusable" style={chip(mode === m)}>{label}</button>
                ))}
            </div>

            {mode === 'open' && (
                <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600, lineHeight: 1.8 }}>
                    يظهر فورَ النشر ويبقى حتى تُوقفه بنفسك.
                </div>
            )}

            {mode === 'days' && (
                <>
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {([['أسبوع', 7], ['أسبوعان', 14], ['شهر', 30], ['٣ أشهر', 90]] as const).map(([label, n]) => (
                            <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n}
                                className="adm-focusable" style={chip(days === n)}>{label}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-fg)' }}>يظهر لمدّة</span>
                        <AdmNumber value={days} onChange={setDays} min={1} max={MAX_SCHEDULE_DAYS}
                            aria-label="عددُ أيام ظهور البانر"
                            style={{ ...field, width: 90, textAlign: 'center' }} />
                        <span style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>يوماً</span>
                    </div>
                    <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600, lineHeight: 1.8 }}>
                        تُحسب <strong>بالدقيقة</strong> من لحظة الحفظ — لا من منتصف الليل.
                    </div>
                </>
            )}

            {mode === 'range' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 9 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>من (اتركه فارغاً = فوراً)</span>
                        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
                            className="adm-focusable" style={field} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>إلى (اتركه فارغاً = بلا نهاية)</span>
                        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                            className="adm-focusable" style={field} />
                    </label>
                </div>
            )}

            {/* 🔴 الخطأُ يُقال هنا **قبل** الحفظ: تواريخُ متناقضة تُحفظ بلا شكوى
                ثمّ تُسقط السياسةُ البانرَ بصمت، فيظنّ الأدمنُ أن النشر فشل. */}
            {result.error && (
                <div role="alert" style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--adm-bad, #dc2626)' }}>
                    ⚠️ {result.error}
                </div>
            )}
        </div>
    );
};

export default BannerSchedule;
