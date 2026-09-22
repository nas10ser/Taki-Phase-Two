import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

/**
 * SiteTrafficPanel — «من أين يأتي الزوّار؟» (v14.80)
 * ═══════════════════════════════════════════════════════════════════════════
 * ثلاثة أسئلة قالها ناصر حرفياً، ولكلٍّ منها قسمٌ هنا:
 *   كم زائراً جاءك؟      ⇐ «الزوّار» + الأعمدة اليومية
 *   من أي قناة؟          ⇐ «القنوات» و«الحملات» و«المواقع المُحيلة»
 *   أي صفحة أوقفتهم؟     ⇐ «آخر صفحة قبل المغادرة» (لمن لم يحجز)
 *
 * كل الأرقام من `admin_site_traffic` — دالّة واحدة، تُحسب في القاعدة، ولا
 * تُرجع شيئاً يعرّف شخصاً (لا عنوان إنترنت ولا معرّف دائم).
 */

type Traffic = any;

const arNum = (n: any) => (Number(n) || 0).toLocaleString('ar-SA');
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** أسماء القنوات بالعربية — وما لا نعرفه يظهر كما هو بدل أن يُخفى. */
const CHANNELS: Record<string, { ar: string; emoji: string }> = {
    direct:    { ar: 'مباشر (كتب العنوان أو من المفضلة)', emoji: '🔗' },
    search:    { ar: 'محركات البحث', emoji: '🔍' },
    instagram: { ar: 'انستقرام', emoji: '📸' },
    twitter:   { ar: 'إكس (تويتر)', emoji: '𝕏' },
    snapchat:  { ar: 'سناب شات', emoji: '👻' },
    tiktok:    { ar: 'تيك توك', emoji: '🎵' },
    facebook:  { ar: 'فيسبوك', emoji: '📘' },
    linkedin:  { ar: 'لينكدإن', emoji: '💼' },
    telegram:  { ar: 'تيليجرام', emoji: '✈️' },
    whatsapp:  { ar: 'واتساب', emoji: '💬' },
    referral:  { ar: 'مواقع أخرى', emoji: '🌐' },
    internal:  { ar: 'من داخل الموقع', emoji: '🏠' },
};
const chLabel = (k: string) => CHANNELS[k] || { ar: k, emoji: '📌' };

/** أعمدة يومية بسيطة بلا أي مكتبة — نفس روح بقيّة اللوحات. */
const Bars: React.FC<{ rows: Array<{ d: string; n: number; booked: number }> }> = ({ rows }) => {
    if (!rows.length) return null;
    const max = Math.max(1, ...rows.map(r => Number(r.n) || 0));
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, direction: 'ltr', marginTop: 8 }}>
            {rows.map(r => {
                const n = Number(r.n) || 0;
                const b = Number(r.booked) || 0;
                return (
                    <div key={r.d} title={`${r.d} — ${arNum(n)} زائر · ${arNum(b)} حجز`}
                         style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 4 }}>
                        <div style={{ height: `${(n / max) * 100}%`, background: 'var(--primary)', borderRadius: '3px 3px 0 0', position: 'relative' }}>
                            {b > 0 && (
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct(b, n)}%`, background: '#16a34a', borderRadius: '0 0 3px 3px' }} />
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const Row: React.FC<{ label: string; n: number; total: number; sub?: string }> = ({ label, n, total, sub }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-color)' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
            {label}
            {sub && <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.72rem' }}> — {sub}</span>}
        </span>
        <span style={{ width: 70, height: 6, background: 'var(--body-bg)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
            <span style={{ display: 'block', width: `${pct(n, total)}%`, height: '100%', background: 'var(--primary)' }} />
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)', minWidth: 34, textAlign: 'left' }}>{arNum(n)}</span>
    </div>
);

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</div>
        {hint && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>{hint}</div>}
        {children}
    </div>
);

const SiteTrafficPanel: React.FC = () => {
    const [days, setDays] = useState(30);
    const [data, setData] = useState<Traffic | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setErr('');
        supabase.rpc('admin_site_traffic', { p_days: days }).then(({ data: d, error }) => {
            if (!alive) return;
            // الخطأ يُقال لا يُبتلع: لوحةٌ فارغة بلا سبب تُقرأ «لا زوّار».
            if (error) setErr(error.message || 'تعذّر جلب البيانات');
            else setData(d);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [days]);

    const t = data?.totals || {};
    const sessions = Number(t.sessions) || 0;
    const channels: any[] = data?.channels || [];
    const exits: any[] = data?.exits || [];
    const landing: any[] = data?.landing || [];
    const referrers: any[] = data?.referrers || [];
    const campaigns: any[] = data?.campaigns || [];
    const devices: any[] = data?.devices || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>🌍 زوّار الموقع ومصادرهم</div>
                <div style={{ display: 'flex', gap: 4, marginRight: 'auto' }}>
                    {[7, 30, 90].map(d => (
                        <button key={d} onClick={() => setDays(d)}
                            style={{
                                padding: '5px 11px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 800,
                                border: '1px solid var(--border-color)', cursor: 'pointer',
                                background: days === d ? 'var(--primary)' : 'var(--card-bg)',
                                color: days === d ? '#fff' : 'var(--text-secondary)',
                            }}>
                            {d === 7 ? 'أسبوع' : d === 30 ? 'شهر' : '٣ أشهر'}
                        </button>
                    ))}
                </div>
            </div>

            {err && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: 12, fontSize: '0.8rem', fontWeight: 700 }}>
                    ⚠️ {err}
                </div>
            )}

            {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, padding: 20, textAlign: 'center' }}>جارِ الحساب…</div>
            ) : sessions === 0 && !err ? (
                <div style={{ background: 'var(--card-bg)', border: '1px dashed var(--border-color)', borderRadius: 16, padding: 22, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>لا زيارات مسجّلة في هذه الفترة</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 6, lineHeight: 1.8 }}>
                        القياس بدأ مع الإصدار v14.80 — فالفترات التي تسبقه فارغة بطبيعتها، لا لأن أحداً لم يزُر.
                        <br />ولمعرفة أثر حملةٍ بعينها أضف <code style={{ direction: 'ltr', display: 'inline-block' }}>?utm_source=instagram</code> إلى الرابط الذي تنشره.
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
                        {[
                            { k: 'الزوّار', v: sessions, hint: 'جلسة تصفّح' },
                            { k: 'حجزوا', v: Number(t.booked) || 0, hint: `${pct(Number(t.booked) || 0, sessions)}٪ من الزوّار` },
                            { k: 'غادروا فوراً', v: Number(t.bounced) || 0, hint: `${pct(Number(t.bounced) || 0, sessions)}٪ صفحة واحدة` },
                            { k: 'مسجّلون', v: Number(t.signed_in) || 0, hint: 'لديهم حساب' },
                            { k: 'من التطبيق', v: Number(t.pwa) || 0, hint: 'مثبَّت على الجوال' },
                        ].map(c => (
                            <div key={c.k} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '10px 12px' }}>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--text-primary)' }}>{arNum(c.v)}</div>
                                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-primary)' }}>{c.k}</div>
                                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{c.hint}</div>
                            </div>
                        ))}
                    </div>

                    <Card title="📈 الزوّار يوماً بيوم" hint="العمود كامل = زوّار · الأخضر داخله = من حجز">
                        <Bars rows={data?.daily || []} />
                    </Card>

                    <Card title="🚪 من أي قناة جاؤوا؟" hint="القناة تُحدَّد من المُحيل أو من وسم الحملة في الرابط">
                        {channels.map((c: any) => {
                            const m = chLabel(c.channel);
                            return <Row key={c.channel} label={`${m.emoji} ${m.ar}`} n={Number(c.n)} total={sessions}
                                        sub={Number(c.booked) > 0 ? `${arNum(c.booked)} حجز` : undefined} />;
                        })}
                    </Card>

                    {exits.length > 0 && (
                        <Card title="🛑 آخر صفحة قبل المغادرة" hint="لمن لم يحجز — أعلى سطرٍ هنا هو أكثر موضعٍ تفقد فيه الزائر">
                            {exits.map((e: any) => <Row key={e.path} label={e.path} n={Number(e.n)} total={sessions} />)}
                        </Card>
                    )}

                    {landing.length > 0 && (
                        <Card title="🛬 أول صفحة دخلوا منها">
                            {landing.map((l: any) => <Row key={l.path} label={l.path} n={Number(l.n)} total={sessions} />)}
                        </Card>
                    )}

                    {campaigns.length > 0 && (
                        <Card title="🎯 الحملات" hint="من الروابط التي تحمل ‎?utm_source=…">
                            {campaigns.map((c: any, i: number) => (
                                <Row key={i} label={[c.source, c.medium, c.campaign].filter(Boolean).join(' · ')}
                                     n={Number(c.n)} total={sessions}
                                     sub={Number(c.booked) > 0 ? `${arNum(c.booked)} حجز` : 'بلا حجز'} />
                            ))}
                        </Card>
                    )}

                    {referrers.length > 0 && (
                        <Card title="🌐 المواقع المُحيلة" hint="اسم الموقع وحده — لا يُخزَّن أي مسار">
                            {referrers.map((r: any) => <Row key={r.host} label={r.host} n={Number(r.n)} total={sessions} />)}
                        </Card>
                    )}

                    {devices.length > 0 && (
                        <Card title="📱 الأجهزة">
                            {devices.map((d: any) => (
                                <Row key={d.device} n={Number(d.n)} total={sessions}
                                     label={d.device === 'mobile' ? '📱 جوال' : d.device === 'tablet' ? '📗 لوحي' : d.device === 'desktop' ? '💻 حاسب' : '؟ غير معروف'} />
                            ))}
                        </Card>
                    )}

                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.9, padding: '0 4px' }}>
                        🔒 لا يُخزَّن عنوان إنترنت ولا كعكة ولا معرّف دائم. معرّف الجلسة يموت بإغلاق التبويب،
                        والمُحيل يُختزل إلى اسم الموقع وحده، والبيانات تُحذف تلقائياً بعد ١٨٠ يوماً.
                    </div>
                </>
            )}
        </div>
    );
};

export default SiteTrafficPanel;
