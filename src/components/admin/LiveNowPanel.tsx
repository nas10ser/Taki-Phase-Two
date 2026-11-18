import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { AdmNumber, SESSIONS, PAGES } from './ui';
import { arCount } from '../../utils/arPlural';

/**
 * LiveNowPanel — «النشطون الآن» مسجَّلون وزوّاراً، بالساعة وبالتفصيل (v16.38)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 طلبُ ناصر (١٨ نوفمبر ٢٠٢٦): «ولا تنسى تضع بالساعه النشطون لحظيا سواء
 *    للمسجلين او الزائرين وايضا تفاصيلهما».
 *
 * كلُّ الأرقام من `admin_live_now` — دالّةٌ واحدة تُجيب الأسئلةَ الثلاثة في
 * نداءٍ واحد (الآن · بالساعة · التفاصيل)، فلا ثلاثةُ استعلاماتٍ لشاشةٍ واحدة
 * على قاعدةٍ بنواةٍ واحدة.
 *
 * 🪤 والنبضُ مصدرُه `site_sessions.last_seen_at`، وقِيس أنه **نبضٌ حقيقيّ** لا
 *    طابعُ إنشاء (٢٦٤ جلسةً يتأخّر فيها عن `started_at`) — ولولا هذا القياس
 *    لكانت «النشطون الآن» تعني «من فتح الموقع يوماً ما».
 *
 * 🪤 والتحديثُ الذاتيُّ **يتوقّف حين تختفي الصفحة**: لوحةٌ متروكةٌ مفتوحةً في
 *    تبويبٍ خلفيّ كانت ستستعلم كلّ نصف دقيقةٍ إلى الأبد. (وهو نفسُ الدرس الذي
 *    جعل استطلاعَ صفحة العروض مشروطاً في v16.14.)
 *
 * 🔒 ولا يُعرض اسمٌ لزائرٍ بلا حساب — الخادمُ لا يُرسل له اسماً أصلاً.
 */

const arNum = (n: unknown) => (Number(n) || 0).toLocaleString('ar-SA');

type Detail = {
    signed_in: boolean; who: string | null; kind: string | null;
    device: string; channel: string; lang: string | null; is_pwa: boolean;
    pages: number; path: string | null; booked: boolean;
    started: string; last_seen: string;
};

const DEVICE_AR: Record<string, string> = {
    mobile: '📱 جوال', tablet: '📗 لوحي', desktop: '💻 حاسب',
};

const Stat: React.FC<{ label: string; value: number; hint?: string; tone?: string }> =
({ label, value, hint, tone }) => (
    <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        borderRadius: 14, padding: '10px 12px',
    }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 900, color: tone || 'var(--text-primary)' }}>{arNum(value)}</div>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{hint}</div>}
    </div>
);

/** أعمدةُ الساعات: الكاملُ = الجميع، والأخضرُ داخله = المسجَّلون. */
const HourBars: React.FC<{ rows: Array<{ h: string; n: number; signed_in: number }> }> = ({ rows }) => {
    const max = Math.max(1, ...rows.map((r) => Number(r.n) || 0));
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, overflowX: 'auto' }}>
            {rows.map((r) => {
                const n = Number(r.n) || 0;
                const s = Number(r.signed_in) || 0;
                const hh = (r.h || '').slice(-2);
                return (
                    <div key={r.h} style={{ flex: '1 0 14px', minWidth: 14, textAlign: 'center' }}
                         title={`${r.h} — ${arCount(n, SESSIONS, false, arNum)} نابضة (منها ${arNum(s)} بحساب)`}>
                        <div style={{
                            height: `${Math.round((n / max) * 68)}px`, minHeight: n > 0 ? 3 : 0,
                            background: 'var(--gray-100)', borderRadius: 4,
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                        }}>
                            <div style={{
                                height: `${n > 0 ? Math.round((s / n) * 100) : 0}%`,
                                background: 'var(--primary)', borderRadius: 4,
                            }} />
                        </div>
                        <div style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', marginTop: 3 }}>{hh}</div>
                    </div>
                );
            })}
        </div>
    );
};

export const LiveNowPanel: React.FC = () => {
    const [minutes, setMinutes] = useState(15);
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(true);
    const alive = useRef(true);

    const load = useCallback(async () => {
        const { data: d, error } = await supabase.rpc('admin_live_now', { p_minutes: minutes });
        if (!alive.current) return;
        // الخطأ يُقال لا يُبتلع: لوحةٌ فارغة بلا سبب تُقرأ «لا أحد الآن».
        if (error) setErr(error.message || 'تعذّر جلب النشاط اللحظي');
        else { setErr(''); setData(d as Record<string, any>); }
        setLoading(false);
    }, [minutes]);

    useEffect(() => {
        alive.current = true;
        load();
        // 🪤 لا استطلاعَ والصفحةُ مخفيّة — تبويبٌ منسيٌّ كان سيستعلم إلى الأبد.
        const tick = () => { if (document.visibilityState === 'visible') load(); };
        const id = window.setInterval(tick, 30_000);
        document.addEventListener('visibilitychange', tick);
        return () => {
            alive.current = false;
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [load]);

    const now = data?.now || {};
    const total = Number(now.total) || 0;
    const signed = Number(now.signed_in) || 0;
    const guests = Number(now.guests) || 0;
    const hourly: Array<{ h: string; n: number; signed_in: number }> = data?.hourly || [];
    const details: Detail[] = data?.details || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                    🟢 النشطون الآن
                </h3>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)' }}>آخر</span>
                <AdmNumber
                    value={minutes} min={1} max={240} commitOnly onChange={setMinutes}
                    aria-label="نافذة النشاط بالدقائق"
                    className="adm-focusable"
                    style={{
                        width: 64, padding: '5px 8px', fontSize: '0.78rem', fontWeight: 800, textAlign: 'center',
                        borderRadius: 10, border: '1px solid var(--border-color)',
                        background: 'var(--card-bg)', color: 'var(--text-primary)',
                    }}
                />
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    دقيقة · يتحدّث تلقائياً
                </span>
            </div>

            {err && (
                <div style={{
                    background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.35)',
                    borderRadius: 12, padding: '9px 12px', fontSize: '0.78rem', fontWeight: 800,
                    color: 'var(--text-primary)',
                }}>⚠️ {err}</div>
            )}

            {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, padding: 16, textAlign: 'center' }}>
                    جارِ القياس…
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
                        <Stat label="نشطون الآن" value={total} tone={total > 0 ? '#10b981' : undefined} hint="جلسةٌ نابضة" />
                        <Stat label="مسجّلون" value={signed} hint="لديهم حساب" />
                        <Stat label="زوّار" value={guests} hint="بلا حساب" />
                        <Stat label="من التطبيق" value={Number(now.pwa) || 0} hint="مثبَّت على الجوال" />
                    </div>

                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 2 }}>
                            ⏱ النشاط بالساعة — آخر ٢٤ ساعة
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>
                            العمود كامل = الجميع · الملوَّن داخله = المسجّلون (بتوقيت الرياض)
                        </div>
                        {hourly.length === 0
                            ? <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>لا نشاط في آخر ٢٤ ساعة.</div>
                            : <HourBars rows={hourly} />}
                    </div>

                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 10 }}>
                            🔍 تفاصيل النشطين الآن
                        </div>
                        {details.length === 0 ? (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                لا أحد نشطٌ في هذه النافذة — وسّعها بالدقائق أعلاه.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {details.map((d, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
                                        padding: '8px 10px', borderRadius: 11,
                                        background: 'var(--body-bg)', border: '1px solid var(--border-color)',
                                    }}>
                                        <span style={{
                                            fontSize: '0.72rem', fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                                            background: d.signed_in ? 'rgba(16,185,129,.14)' : 'var(--gray-100)',
                                            color: d.signed_in ? '#047857' : 'var(--text-secondary)',
                                        }}>
                                            {d.signed_in ? (d.who || 'مسجّل') : 'زائر'}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                            {DEVICE_AR[d.device] || '؟ غير معروف'}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                            {arCount(Number(d.pages) || 0, PAGES, false, arNum)}
                                        </span>
                                        {d.is_pwa && <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)' }}>تطبيق</span>}
                                        {d.booked && <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#047857' }}>حجز ✓</span>}
                                        <span style={{
                                            flex: 1, minWidth: 90, direction: 'ltr', textAlign: 'left',
                                            fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>{d.path || '—'}</span>
                                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                            {(d.last_seen || '').slice(-5)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default LiveNowPanel;
