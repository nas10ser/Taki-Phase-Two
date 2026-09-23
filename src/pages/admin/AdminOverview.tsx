/**
 * AdminOverview — الشاشة الأولى: حالة المنصّة الآن (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ما حُذف، وقد قِيس تكرارُه:
 *   • **الأزرار الثلاثة الكبيرة** («المشترون» · «البائعون» · «الأدوات»):
 *     كانت تكرّر وجهاتٍ موجودةً في شريط التنقّل على بُعد سنتيمترٍ واحد فوقها.
 *   • **اللافتة الترحيبية** بتدرّجٍ ثلاثيّ وكرتَي ضبابٍ ونبضة: تشغل أعلى
 *     الشاشة كاملاً ولا تحمل رقماً واحداً. حلّ محلّها سطرٌ واحد.
 *   • **بطاقات التدرّجات**: أربع بطاقاتٍ بأربعة تدرّجات تتنافس على الانتباه.
 *     الأرقام الآن على سطحٍ واحدٍ هادئ، واللون للدلالة وحدها.
 *
 * 🪤 وما أُضيف لأن غيابه كان العيب الحقيقي: **«يحتاج قراراً منك»**. كانت
 *    الشاشة الأولى تقول «كل شيء تحت سيطرتك» ولا تقول ما الذي ينتظر قراراً —
 *    فالبلاغ المفتوح لا يُرى إلا بفتح تبويبه.
 *
 * 🪤 وكل رقمٍ هنا يقول **نطاقه** صراحةً: قِيس أن بطاقاتٍ بنفس الاسم تعني في
 *    شاشةٍ «كل المنصّة» وفي أخرى «الصفحة المعروضة» — والقارئ لا يملك ما يفرّق.
 */

import React, { useEffect, useState, useCallback, memo } from 'react';
import { adminService, LiveStats, ActivityRow } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { useKpiSnapshot } from '../../hooks/useKpiSnapshot';
import { AdmCard, AdmSection, AdmStat, AdmStatGrid, AdmPill, AdmEmpty, AdmSkeleton, AdmButton, admNum, admMoney } from '../../components/admin/ui';
import { AdminTabId } from '../../data/adminNav';

// ═══════════════════════════════════════════════════════════════════════════
// سجلّ النشاط
// ═══════════════════════════════════════════════════════════════════════════

const ACTION_META: Record<string, { icon: string; label: string }> = {
    login: { icon: '🔓', label: 'سجّل دخول' },
    register: { icon: '✨', label: 'سجّل حساباً جديداً' },
    book: { icon: '🎟️', label: 'حجز عرضاً' },
    cancel_booking: { icon: '❌', label: 'ألغى حجزاً' },
    view_deal: { icon: '👀', label: 'شاهد عرضاً' },
    add_deal: { icon: '➕', label: 'أضاف عرضاً' },
    edit_deal: { icon: '✏️', label: 'عدّل عرضاً' },
    delete_deal: { icon: '🗑️', label: 'حذف عرضاً' },
    follow: { icon: '⭐', label: 'تابع متجراً' },
    rate: { icon: '💬', label: 'قيّم عرضاً' },
    admin_apply_subscription: { icon: '👑', label: 'طبّق اشتراكاً' },
    admin_update_user: { icon: '🛠️', label: 'عدّل مستخدماً' },
};

function timeAgo(iso: string, now: number): string {
    const sec = Math.floor((now - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `قبل ${sec} ثانية`;
    if (sec < 3600) return `قبل ${Math.floor(sec / 60)} دقيقة`;
    if (sec < 86400) return `قبل ${Math.floor(sec / 3600)} ساعة`;
    return new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory');
}


/**
 * دلتا «مقابل أمس» → شارةٌ نصّية. تعود `undefined` حين لا خطَّ أساس بعد
 * (أوّل يومٍ يفتح فيه ناصر اللوحة) — فلا تُعرض شارةٌ تقول «٠٪» كأنها قياس.
 */
function deltaChip(d: { pct: number | null; diff: number | null } | undefined): { text: string; good?: boolean } | undefined {
    if (!d || d.pct === null || d.diff === null) return undefined;
    const sign = d.diff > 0 ? '▲' : d.diff < 0 ? '▼' : '—';
    return { text: `${sign} ${Math.abs(Math.round(d.pct))}٪ عن أمس`, good: d.diff === 0 ? undefined : d.diff > 0 };
}

const ActivityRowView = memo<{ row: ActivityRow; now: number }>(({ row, now }) => {
    const meta = ACTION_META[row.action] ?? { icon: '•', label: row.action };
    return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--adm-border)' }}>
            <span
                aria-hidden="true"
                style={{
                    flexShrink: 0, width: 30, height: 30, borderRadius: 999,
                    background: 'var(--adm-surface-3)', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '.85rem',
                }}
            >
                {meta.icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.83rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '16ch' }}>
                        {row.user_name ?? 'زائر'}
                    </span>
                    <span style={{ fontSize: '.78rem', color: 'var(--adm-fg-2)' }}>{meta.label}</span>
                </span>
            </span>
            <span style={{ flexShrink: 0, fontSize: '.7rem', color: 'var(--adm-fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                {timeAgo(row.created_at, now)}
            </span>
        </div>
    );
});
ActivityRowView.displayName = 'ActivityRowView';

// ═══════════════════════════════════════════════════════════════════════════

const AdminOverview: React.FC<{ onNavigate: (tab: AdminTabId) => void }> = ({ onNavigate }) => {
    const { user, hasPermission } = useApp();
    const [stats, setStats] = useState<LiveStats | null>(null);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [openReports, setOpenReports] = useState<number | null>(null);
    const [openComplaints, setOpenComplaints] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const { deltas } = useKpiSnapshot(stats);

    const canSeeFinance = hasPermission('action_view_finance');
    const canSeeReports = hasPermission('tab_reports');

    const refresh = useCallback(async () => {
        const [s, a] = await Promise.all([
            adminService.getLiveStats(5, false),
            adminService.getRecentActivity(20),
        ]);
        if (s) setStats(s);
        setActivity(a);
        setNow(Date.now());
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 5000);
        return () => clearInterval(id);
    }, [refresh]);

    // «يحتاج قراراً»: يُقرأ مرّةً عند الفتح وكل دقيقة — لا كل خمس ثوانٍ، فهو
    // ليس عدّاداً لحظياً بل طابور عمل.
    useEffect(() => {
        if (!canSeeReports) return;
        let alive = true;
        const load = async () => {
            try {
                const [r, c] = await Promise.all([
                    adminService.listReports({ status: 'open', limit: 100 }),
                    adminService.listComplaints({ status: 'open', limit: 100 }),
                ]);
                if (!alive) return;
                setOpenReports(Array.isArray(r) ? r.length : 0);
                setOpenComplaints(Array.isArray(c) ? c.length : 0);
            } catch { /* طابورٌ لا يُفشل الشاشة */ }
        };
        load();
        const id = setInterval(load, 60000);
        return () => { alive = false; clearInterval(id); };
    }, [canSeeReports]);

    const pending = (openReports ?? 0) + (openComplaints ?? 0);

    return (
        <div style={{ display: 'grid', gap: 14 }} dir="rtl">

            {/* ── ما يحتاج قراراً ─────────────────────────────────────────── */}
            {canSeeReports && (
                <AdmCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: pending ? 12 : 0 }}>
                        <span style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--adm-fg)' }}>
                            يحتاج قراراً منك
                        </span>
                        {openReports === null ? (
                            <AdmPill>جارٍ الفحص</AdmPill>
                        ) : pending === 0 ? (
                            <AdmPill tone="ok">لا شيء ينتظرك الآن</AdmPill>
                        ) : (
                            <AdmPill tone="warn">{pending} بنداً</AdmPill>
                        )}
                    </div>

                    {pending > 0 && (
                        <div style={{ display: 'grid', gap: 8 }}>
                            {!!openReports && (
                                <QueueRow
                                    icon="🚩"
                                    title={`${openReports} بلاغاً مفتوحاً`}
                                    desc="بلاغات المستخدمين على بعضهم — لم تُراجَع بعد."
                                    onOpen={() => onNavigate('reports')}
                                />
                            )}
                            {!!openComplaints && (
                                <QueueRow
                                    icon="📣"
                                    title={`${openComplaints} شكوى مفتوحة`}
                                    desc="شكاوى وصلت الإدارة مباشرةً من المستخدمين."
                                    onOpen={() => onNavigate('reports')}
                                />
                            )}
                        </div>
                    )}
                </AdmCard>
            )}

            {/* ── الأرقام اللحظية ─────────────────────────────────────────── */}
            <AdmSection
                title="الآن على المنصّة"
                desc="تُحدَّث كل خمس ثوانٍ. كل رقمٍ هنا عن المنصّة كلّها."
                icon="⚡"
                action={<AdmButton size="sm" onClick={() => onNavigate('analytics')}>التحليلات الكاملة ←</AdmButton>}
            >
                {loading && !stats ? (
                    <AdmSkeleton rows={2} height={84} />
                ) : (
                    <AdmStatGrid cols={4}>
                        <AdmStat
                            icon="🟢"
                            label="مستخدم نشط"
                            value={admNum(stats?.active_users)}
                            scope="آخر ٥ دقائق"
                            tone="ok"
                        />
                        <AdmStat
                            icon="🎟️"
                            label="حجوزات اليوم"
                            value={admNum(stats?.bookings_today)}
                            scope={`${admNum(stats?.bookings_hour)} في آخر ساعة`}
                            delta={deltaChip(deltas.bookings)}
                        />
                        <AdmStat
                            icon="✨"
                            label="مستخدم جديد اليوم"
                            value={admNum(stats?.new_users_today)}
                            scope={`من ${admNum(stats?.total_users)} إجمالاً`}
                            delta={deltaChip(deltas.new_users)}
                        />
                        {/* 🪤 «الأمور المالية» تُخفى لا تُعطَّل — أدمنٌ مُنعت عنه
                            لا يقرأ الإيراد أصلاً (درس v14.38). */}
                        {canSeeFinance && (
                            <AdmStat
                                icon="💰"
                                label="اشتراكات شهرية"
                                value={admMoney(stats?.mrr)}
                                scope={`${admNum(stats?.paying_sellers)} مشترك · قبل الخصومات`}
                                delta={deltaChip(deltas.mrr)}
                                title="مجموع مبالغ الاشتراكات النشطة كما هي مسجّلة، قبل طرح أي خصم. الرقم بعد الخصومات في شاشة التجّار."
                            />
                        )}
                    </AdmStatGrid>
                )}
            </AdmSection>

            {/* ── حجم المنصّة ─────────────────────────────────────────────── */}
            <AdmSection
                title="حجم المنصّة"
                desc="الأعداد الإجمالية منذ الإطلاق."
                icon="📦"
                collapsible
                defaultOpen={false}
            >
                <AdmStatGrid cols={3}>
                    <AdmStat label="مشترٍ" value={admNum(stats?.total_buyers)} scope="كل المنصّة" icon="🛒"
                        onClick={hasPermission('tab_buyers') ? () => onNavigate('buyers') : undefined} />
                    <AdmStat label="تاجر" value={admNum(stats?.total_sellers)} scope="كل المنصّة" icon="🏪"
                        onClick={hasPermission('tab_sellers') ? () => onNavigate('sellers') : undefined} />
                    <AdmStat label="حساب" value={admNum(stats?.total_users)} scope="مشترون وتجّار" icon="👥" />
                </AdmStatGrid>
            </AdmSection>

            {/* ── النشاط اللحظي ───────────────────────────────────────────── */}
            <AdmSection
                title="النشاط اللحظي"
                desc="آخر عشرين حدثاً على المنصّة."
                icon="📡"
                badge={{ text: 'مباشر', tone: 'ok' }}
            >
                {loading ? (
                    <AdmSkeleton rows={4} height={44} />
                ) : activity.length === 0 ? (
                    <AdmEmpty
                        icon="📡"
                        title="لا نشاط بعد"
                        hint="أول دخولٍ أو حجزٍ على المنصّة سيظهر هنا مباشرةً."
                    />
                ) : (
                    <div>
                        {activity.map((row) => <ActivityRowView key={row.id} row={row} now={now} />)}
                    </div>
                )}
            </AdmSection>

            <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)', textAlign: 'center', paddingTop: 4 }}>
                مرحباً {user?.name ?? 'بك'} — هذه شاشة الإدارة.
            </div>
        </div>
    );
};

const QueueRow: React.FC<{ icon: string; title: string; desc: string; onOpen: () => void }> = ({ icon, title, desc, onOpen }) => (
    <div
        style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '11px 12px', borderRadius: 'var(--adm-r-sm)',
            background: 'var(--adm-warn-bg)',
        }}
    >
        <span aria-hidden="true" style={{ fontSize: '1rem' }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 140 }}>
            <span style={{ display: 'block', fontSize: '.85rem', fontWeight: 900, color: 'var(--adm-warn-fg)' }}>{title}</span>
            <span style={{ display: 'block', fontSize: '.75rem', color: 'var(--adm-fg-2)', marginTop: 2, lineHeight: 1.7 }}>{desc}</span>
        </span>
        <AdmButton size="sm" onClick={onOpen}>افتحها ←</AdmButton>
    </div>
);

export default memo(AdminOverview);
