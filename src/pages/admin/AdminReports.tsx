import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { adminService, AdminReportRow, AdminComplaintRow } from '../../services/adminService';

/**
 * Admin "Reports & Complaints" center. Owner requirements:
 *  - see who reported whom (both identities), open the seller's account,
 *  - per-account counts (received vs. filed) to expose malicious
 *    serial reporters, distinct-reporter count (the 3/14d threshold),
 *  - filters (search / type / status / days / role),
 *  - complaints surface here too (not email-only),
 *  - manual handling only (status changes; no auto-restriction).
 */

const REPORT_TYPES = ['scam', 'no_show', 'harassment', 'inappropriate', 'spam', 'other'];

const fmt = (iso: string, isRTL: boolean) => {
    try {
        return new Date(iso).toLocaleString(isRTL ? 'ar-SA' : 'en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch { return iso; }
};

const STATUS_COLORS: Record<string, string> = {
    open: '#f59e0b', under_review: '#dc2626', reviewing: '#dc2626',
    resolved: '#16a34a', dismissed: '#6b7280',
};

const AdminReports: React.FC = () => {
    const { language, customConfirm, customAlert } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';

    const [view, setView] = useState<'reports' | 'complaints'>('reports');
    const [reports, setReports] = useState<AdminReportRow[]>([]);
    const [complaints, setComplaints] = useState<AdminComplaintRow[]>([]);
    const [loading, setLoading] = useState(true);

    const [q, setQ] = useState('');
    const [status, setStatus] = useState<string>('');
    const [rtype, setRtype] = useState<string>('');
    const [days, setDays] = useState<number>(0);
    const [role, setRole] = useState<string>('');

    const load = useCallback(async () => {
        setLoading(true);
        if (view === 'reports') {
            const rows = await adminService.listReports({
                query: q, status: status || null, type: rtype || null,
                reportedRole: (role || null) as any, days,
            });
            setReports(rows);
        } else {
            const rows = await adminService.listComplaints({ query: q, status: status || null });
            setComplaints(rows);
        }
        setLoading(false);
    }, [view, q, status, rtype, days, role]);

    useEffect(() => { load(); }, [load]);

    const changeReportStatus = async (id: string, next: string) => {
        const ok = await customConfirm(isRTL ? `تغيير حالة البلاغ إلى «${next}»؟` : `Set report status to "${next}"?`);
        if (!ok) return;
        const r = await adminService.setReportStatus(id, next);
        if (r.success) load();
        else customAlert(isRTL ? '❌ تعذّر تحديث الحالة' : '❌ Could not update status');
    };
    const changeComplaintStatus = async (id: string, next: string) => {
        const ok = await customConfirm(isRTL ? `تغيير حالة الشكوى إلى «${next}»؟` : `Set complaint status to "${next}"?`);
        if (!ok) return;
        const r = await adminService.setComplaintStatus(id, next);
        if (r.success) load();
        else customAlert(isRTL ? '❌ تعذّر تحديث الحالة' : '❌ Could not update status');
    };

    const openAccount = (id: string, partyRole: string) => {
        // Sellers have a public store page; buyers do not — for buyers we
        // jump to the Buyers admin tab pre-filtered by their id.
        if (partyRole === 'seller') history.push(`/store/${id}`);
        else history.push(`/admin?tab=buyers&q=${encodeURIComponent(id)}`);
    };

    const inp: React.CSSProperties = {
        padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-color, #ddd)',
        background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #111)', fontSize: '0.85rem', fontWeight: 700,
    };
    const chip = (active: boolean): React.CSSProperties => ({
        padding: '8px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
        fontWeight: 800, fontSize: '0.85rem',
        background: active ? 'var(--primary)' : 'var(--gray-100, #eee)',
        color: active ? '#fff' : 'var(--text-primary, #111)',
    });
    const pill = (s: string): React.CSSProperties => ({
        background: (STATUS_COLORS[s] || '#888') + '22', color: STATUS_COLORS[s] || '#888',
        padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 900,
    });
    const actBtn: React.CSSProperties = {
        border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: '0.72rem',
        fontWeight: 800, cursor: 'pointer', background: 'var(--gray-100,#eee)', color: 'var(--text-primary,#111)',
    };

    return (
        <div dir={isRTL ? 'rtl' : 'ltr'} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
                <button style={chip(view === 'reports')} onClick={() => { setView('reports'); setStatus(''); }}>
                    🚩 {isRTL ? 'البلاغات' : 'Reports'}
                </button>
                <button style={chip(view === 'complaints')} onClick={() => { setView('complaints'); setStatus(''); }}>
                    📣 {isRTL ? 'الشكاوى' : 'Complaints'}
                </button>
                <button style={{ ...actBtn, marginInlineStart: 'auto', padding: '8px 14px' }} onClick={load}>
                    🔄 {isRTL ? 'تحديث' : 'Refresh'}
                </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input style={{ ...inp, flex: 1, minWidth: 160 }}
                    value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder={isRTL ? 'بحث: اسم/جوال/معرّف/نص' : 'Search: name / phone / id / text'} />
                <select style={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">{isRTL ? 'كل الحالات' : 'All statuses'}</option>
                    <option value="open">{isRTL ? 'مفتوح' : 'Open'}</option>
                    {view === 'reports'
                        ? <option value="under_review">{isRTL ? 'تحت المراجعة' : 'Under review'}</option>
                        : <option value="reviewing">{isRTL ? 'قيد المراجعة' : 'Reviewing'}</option>}
                    <option value="resolved">{isRTL ? 'تم الحل' : 'Resolved'}</option>
                    <option value="dismissed">{isRTL ? 'مرفوض' : 'Dismissed'}</option>
                </select>
                {view === 'reports' && (
                    <>
                        <select style={inp} value={rtype} onChange={(e) => setRtype(e.target.value)}>
                            <option value="">{isRTL ? 'كل الأنواع' : 'All types'}</option>
                            {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select style={inp} value={role} onChange={(e) => setRole(e.target.value)}>
                            <option value="">{isRTL ? 'الطرف المُبلَّغ: الكل' : 'Reported: any'}</option>
                            <option value="seller">{isRTL ? 'تاجر' : 'Seller'}</option>
                            <option value="buyer">{isRTL ? 'مشتري' : 'Buyer'}</option>
                        </select>
                        <select style={inp} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                            <option value="0">{isRTL ? 'كل الفترات' : 'All time'}</option>
                            <option value="1">{isRTL ? 'آخر يوم' : 'Last 1d'}</option>
                            <option value="7">{isRTL ? 'آخر 7 أيام' : 'Last 7d'}</option>
                            <option value="14">{isRTL ? 'آخر 14 يوم' : 'Last 14d'}</option>
                            <option value="30">{isRTL ? 'آخر 30 يوم' : 'Last 30d'}</option>
                        </select>
                    </>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)', fontWeight: 800 }}>
                    {isRTL ? 'جارٍ التحميل…' : 'Loading…'}
                </div>
            ) : view === 'reports' ? (
                reports.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)', fontWeight: 800 }}>
                        {isRTL ? 'لا توجد بلاغات' : 'No reports'}
                    </div>
                ) : reports.map(r => (
                    <div key={r.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                            <div style={{ fontWeight: 900, fontSize: '0.9rem' }}>
                                {isRTL ? 'النوع' : 'Type'}: {r.report_type} · <span style={pill(r.status)}>{r.status}</span>
                                {r.reported_under_review && (
                                    <span style={{ ...pill('under_review'), marginInlineStart: 6 }}>
                                        {isRTL ? '⚠️ تحت المراجعة' : '⚠️ under review'}
                                    </span>
                                )}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--gray-400)', fontWeight: 700 }}>{fmt(r.created_at, isRTL)}</div>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <button style={actBtn} onClick={() => openAccount(r.reporter_id, r.reporter_role)}>
                                {isRTL ? '👤 المبلِّغ:' : '👤 By:'} {r.reporter_name} ({r.reporter_role}) ·{' '}
                                {isRTL ? `أعطى ${r.reporter_filed_count} بلاغ` : `${r.reporter_filed_count} filed`}
                            </button>
                            <span style={{ fontWeight: 900 }}>→</span>
                            <button style={{ ...actBtn, background: 'rgba(220,38,38,0.10)', color: '#dc2626' }} onClick={() => openAccount(r.reported_id, r.reported_role)}>
                                {isRTL ? '🎯 ضد:' : '🎯 Against:'} {r.reported_name} ({r.reported_role}) ·{' '}
                                {isRTL
                                    ? `استلم ${r.reported_received_count} · ${r.reported_distinct_reporters} مبلِّغ مختلف/14ي`
                                    : `${r.reported_received_count} recv · ${r.reported_distinct_reporters} distinct/14d`}
                            </button>
                            {r.reporter_phone && <span style={{ fontSize: '0.72rem', color: 'var(--gray-400)', fontWeight: 700 }}>📞 {r.reporter_phone}</span>}
                        </div>

                        <p style={{ margin: '0 0 10px', fontSize: '0.88rem', lineHeight: 1.6, fontWeight: 600, whiteSpace: 'pre-wrap' }}>{r.reason}</p>
                        {r.admin_note && <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>📝 {r.admin_note}</p>}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button style={{ ...actBtn, background: 'rgba(220,38,38,0.12)', color: '#dc2626' }} onClick={() => changeReportStatus(r.id, 'under_review')}>{isRTL ? 'تحت المراجعة' : 'Under review'}</button>
                            <button style={{ ...actBtn, background: 'rgba(22,163,74,0.12)', color: '#16a34a' }} onClick={() => changeReportStatus(r.id, 'resolved')}>{isRTL ? 'تم الحل' : 'Resolved'}</button>
                            <button style={actBtn} onClick={() => changeReportStatus(r.id, 'dismissed')}>{isRTL ? 'رفض (كيدي)' : 'Dismiss'}</button>
                        </div>
                    </div>
                ))
            ) : (
                complaints.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)', fontWeight: 800 }}>
                        {isRTL ? 'لا توجد شكاوى' : 'No complaints'}
                    </div>
                ) : complaints.map(c => (
                    <div key={c.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                            <div style={{ fontWeight: 900, fontSize: '0.9rem' }}>
                                {c.category}{c.subject ? ` · ${c.subject}` : ''} · <span style={pill(c.status)}>{c.status}</span>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--gray-400)', fontWeight: 700 }}>{fmt(c.created_at, isRTL)}</div>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <button style={actBtn} onClick={() => openAccount(c.user_id, c.user_type === 'seller' ? 'seller' : 'buyer')}>
                                {isRTL ? '👤 من:' : '👤 From:'} {c.user_name} ({c.user_type || '—'})
                            </button>
                            {c.user_phone && <span style={{ fontSize: '0.72rem', color: 'var(--gray-400)', fontWeight: 700, marginInlineStart: 8 }}>📞 {c.user_phone}</span>}
                        </div>
                        <p style={{ margin: '0 0 10px', fontSize: '0.88rem', lineHeight: 1.6, fontWeight: 600, whiteSpace: 'pre-wrap' }}>{c.message}</p>
                        {c.admin_note && <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>📝 {c.admin_note}</p>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button style={{ ...actBtn, background: 'rgba(220,38,38,0.12)', color: '#dc2626' }} onClick={() => changeComplaintStatus(c.id, 'reviewing')}>{isRTL ? 'قيد المراجعة' : 'Reviewing'}</button>
                            <button style={{ ...actBtn, background: 'rgba(22,163,74,0.12)', color: '#16a34a' }} onClick={() => changeComplaintStatus(c.id, 'resolved')}>{isRTL ? 'تم الحل' : 'Resolved'}</button>
                            <button style={actBtn} onClick={() => changeComplaintStatus(c.id, 'dismissed')}>{isRTL ? 'رفض' : 'Dismiss'}</button>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default AdminReports;
