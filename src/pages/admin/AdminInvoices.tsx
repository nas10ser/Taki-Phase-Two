/**
 * AdminInvoices v12.81 — «🧾 فواتير الموقع» (مركز سجل الدفع المباشر).
 *
 * مبدأ ناصر المعتمد: «الموقع يحفظ الفواتير دون إصدار» — التخزين سجل خفيف
 * دائماً (platform_payment_log — صف واحد لكل عملية من الـwebhook)، والتوليد
 * (PDF/CSV) عند الطلب فقط. مصمم لملايين العمليات:
 *  - keyset pagination (50 صفاً بالطلب — لا OFFSET عميق مهما كبر السجل)
 *  - بطاقات مجاميع عبر RPC تجميعية تعمل على الفهارس دون جلب صفوف
 *  - PDF الفاتورة يتولد في المتصفح لحظة الضغط (بترويسة التاجر — هو مصدر
 *    الفاتورة نظاماً وتاكي «سجل وسيط» فقط)
 *  - تصدير CSV بدفعات 10K صف وبحد نطاق شهر واحد لكل تصدير
 *  - إدارة بوابات التجار (إيقاف/تفعيل إداري) + مفتاح الإيقاف الشامل
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import { openPrintWindow } from '../../utils/invoice';
import { downloadCsv } from '../../utils/csvExport';

interface LogRow {
    id: number;
    booking_barcode: string;
    merchant_id: string;
    merchant_name: string | null;
    buyer_id: string | null;
    buyer_name: string | null;
    amount: number;
    vat_amount: number;
    provider: string;
    payment_ref: string;
    status: string;
    created_at: string;
}

interface GatewayRow {
    merchant_id: string;
    store_name: string | null;
    provider: string;
    payment_modes: string;
    is_enabled: boolean;
    disabled_by_admin: boolean;
    verified_at: string | null;
    fail_count: number;
    key_last4: string | null;
    agreement_accepted_at: string | null;
    created_at: string;
}

const PROVIDER_AR: Record<string, string> = {
    moyasar: 'ميسر', tap: 'تاب', paytabs: 'بيتابس',
    payfort: 'بيفورت', hyperpay: 'هايبر باي', checkout: 'Checkout.com',
};
const STATUS_AR: Record<string, string> = { paid: 'مدفوعة', amount_mismatch: '⚠️ مبلغ غير مطابق', refunded: 'مستردة' };

const fmtDate = (iso: string) => {
    const d = new Date(iso);
    // 'ar-SA' وحدها تطبع هجرياً — نجبر الميلادي (قاعدة ثابتة)
    return `${d.toLocaleDateString('ar-SA-u-ca-gregory')} ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`;
};

const inputStyle: React.CSSProperties = {
    padding: '10px 12px', borderRadius: 12, border: '1.5px solid var(--border-color)',
    background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.8rem', outline: 'none',
};

const AdminInvoices: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [rows, setRows] = useState<LogRow[]>([]);
    const [stats, setStats] = useState<{ count: number; total: number; vat_total: number } | null>(null);
    const [gateways, setGateways] = useState<GatewayRow[]>([]);
    const [directPayOn, setDirectPayOn] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    // فلاتر — التاريخ من/إلى + تاجر + مزود + حالة
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [merchantFilter, setMerchantFilter] = useState('');
    const [providerFilter, setProviderFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const filterArgs = useCallback(() => ({
        p_from: fromDate ? new Date(fromDate).toISOString() : null,
        // «إلى» شامل لليوم كاملاً — نضيف يوماً ونستخدم < في الـRPC
        p_to: toDate ? new Date(new Date(toDate).getTime() + 86400000).toISOString() : null,
        p_merchant: merchantFilter || null,
        p_provider: providerFilter || null,
        p_status: statusFilter || null,
    }), [fromDate, toDate, merchantFilter, providerFilter, statusFilter]);

    const loadPage = useCallback(async (beforeId: number | null) => {
        const { data, error } = await supabase.rpc('admin_payment_log', { ...filterArgs(), p_before_id: beforeId, p_limit: 50 });
        if (error) throw error;
        return (data || []) as LogRow[];
    }, [filterArgs]);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [page, { data: st }, { data: gws }, { data: dp }] = await Promise.all([
                loadPage(null),
                supabase.rpc('admin_payment_log_stats', filterArgs()),
                supabase.rpc('admin_list_gateways'),
                supabase.from('platform_settings').select('value').eq('key', 'direct_pay_enabled').maybeSingle(),
            ]);
            setRows(page);
            setHasMore(page.length === 50);
            const s = st as any;
            setStats(s ? { count: Number(s.count) || 0, total: Number(s.total) || 0, vat_total: Number(s.vat_total) || 0 } : null);
            setGateways((gws || []) as GatewayRow[]);
            setDirectPayOn(dp?.value === true);
        } catch (e: any) {
            customAlert(`❌ تعذّر تحميل السجل: ${e?.message || 'خطأ'}`);
        } finally {
            setLoading(false);
        }
    }, [loadPage, filterArgs, customAlert]);

    useEffect(() => { refresh(); }, [refresh]);

    const loadMore = async () => {
        if (loadingMore || rows.length === 0) return;
        setLoadingMore(true);
        try {
            const page = await loadPage(rows[rows.length - 1].id);
            setRows(prev => [...prev, ...page]);
            setHasMore(page.length === 50);
        } catch (e: any) {
            customAlert(`❌ ${e?.message || 'خطأ'}`);
        } finally {
            setLoadingMore(false);
        }
    };

    // PDF فردي — بترويسة التاجر (مصدر الفاتورة نظاماً)، تاكي سجل وسيط فقط
    const printRow = (r: LogRow) => {
        const html = `<div class="inv">
 <h1>🧾 سند عملية دفع إلكتروني <span class="badge">${STATUS_AR[r.status] || r.status}</span></h1>
 <div class="sub">البائع (مصدر الفاتورة الضريبية نظاماً): ${r.merchant_name || r.merchant_id}</div>
 <div class="meta">
  رقم العملية: <b>PPL-${r.id}</b><br>
  مرجع بوابة الدفع: <b>${r.payment_ref}</b><br>
  رقم الحجز: <b>${r.booking_barcode}</b><br>
  التاريخ: <b>${fmtDate(r.created_at)}</b><br>
  العميل: <b>${r.buyer_name || r.buyer_id || '—'}</b><br>
  بوابة الدفع: <b>${PROVIDER_AR[r.provider] || r.provider}</b>
 </div>
 <table><tr><th>البند</th><th>المبلغ (ر.س)</th></tr>
  <tr class="tot"><td>المبلغ المدفوع لحساب التاجر مباشرة</td><td>${Number(r.amount).toFixed(2)}</td></tr></table>
 <div class="qr">هذا سند مرجعي صادر من منصة تاكي بصفتها «وسيطاً تقنياً للربط والعرض فقط» — المبلغ انتقل من العميل
 إلى حساب التاجر مباشرة عبر بوابة دفع مرخصة، والفاتورة الضريبية (ZATCA) تصدر من التاجر بصفته البائع.</div>
 <div class="foot">سجل صادر إلكترونياً من منصة تاكي</div></div>`;
        if (!openPrintWindow(`سند دفع PPL-${r.id}`, html)) {
            customAlert('❌ المتصفح حجب نافذة الطباعة — اسمح بالنوافذ المنبثقة');
        }
    };

    // تصدير CSV — يتطلب نطاق تاريخ بحد شهر، دفعات 10K صف من الخادم
    const exportCsv = async () => {
        if (!fromDate || !toDate) {
            customAlert('📅 حدد «من تاريخ» و«إلى تاريخ» أولاً — التصدير بحد شهر واحد لكل ملف (الطلبات الأكبر تُقسَّم شهراً بشهر)');
            return;
        }
        setExporting(true);
        try {
            const all: LogRow[] = [];
            let before: number | null = null;
            for (let i = 0; i < 200; i++) {
                const { data, error } = await supabase.rpc('admin_payment_log_export', { ...filterArgs(), p_before_id: before });
                if (error) throw error;
                const chunk = (data || []) as LogRow[];
                all.push(...chunk);
                if (chunk.length < 10000) break;
                before = chunk[chunk.length - 1].id;
            }
            const ok = downloadCsv(`taki-payments-${fromDate}--${toDate}`, all, [
                { header: 'رقم العملية', accessor: (r: LogRow) => r.id },
                { header: 'التاريخ', accessor: (r: LogRow) => new Date(r.created_at) },
                { header: 'المتجر', accessor: (r: LogRow) => r.merchant_name || r.merchant_id },
                { header: 'رقم الحجز', accessor: (r: LogRow) => r.booking_barcode },
                { header: 'المبلغ (ر.س)', accessor: (r: LogRow) => Number(r.amount).toFixed(2) },
                { header: 'البوابة', accessor: (r: LogRow) => PROVIDER_AR[r.provider] || r.provider },
                { header: 'مرجع البوابة', accessor: (r: LogRow) => r.payment_ref },
                { header: 'الحالة', accessor: (r: LogRow) => STATUS_AR[r.status] || r.status },
            ]);
            customAlert(ok ? `✅ تم تصدير ${all.length} عملية` : '❌ تعذّر إنشاء الملف');
        } catch (e: any) {
            const msg = String(e?.message || '');
            customAlert(msg.includes('RANGE_TOO_WIDE')
                ? '📅 النطاق أوسع من شهر — قسّم التصدير شهراً بشهر حفاظاً على سرعة الموقع'
                : `❌ فشل التصدير: ${msg}`);
        } finally {
            setExporting(false);
        }
    };

    const toggleDirectPay = async () => {
        const next = !directPayOn;
        const ok = await customConfirm(next
            ? 'تفعيل «الدفع المباشر لحساب التاجر» على مستوى المنصة؟ سيظهر «ادفع الآن» لعملاء التجار المفعّلين.'
            : '⚠️ إيقاف الدفع الإلكتروني على مستوى المنصة بالكامل؟ كل المنتجات تعود لـ«عند الاستلام» فوراً.');
        if (!ok) return;
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'direct_pay_enabled',
            value: next as any,
            description: 'الدفع المباشر لحساب التاجر (0% عمولة) — إيقافه يخفي «ادفع الآن» في كل المنصة فوراً',
            updated_at: new Date().toISOString(),
        });
        if (error) customAlert(`❌ ${error.message}`);
        else { setDirectPayOn(next); customAlert(next ? '✅ الدفع المباشر مفعّل' : '⏸ الدفع المباشر موقوف'); }
    };

    const toggleGatewayBlock = async (g: GatewayRow) => {
        const block = !g.disabled_by_admin;
        const ok = await customConfirm(block
            ? `إيقاف بوابة «${g.store_name || g.merchant_id}» إدارياً؟ منتجاته تعود لعند الاستلام تلقائياً وسيصله إشعار.`
            : `إعادة تفعيل بوابة «${g.store_name || g.merchant_id}»؟`);
        if (!ok) return;
        const { error } = await supabase.rpc('admin_set_gateway_blocked', { p_merchant_id: g.merchant_id, p_blocked: block });
        if (error) customAlert(`❌ ${error.message}`);
        else {
            setGateways(prev => prev.map(x => x.merchant_id === g.merchant_id ? { ...x, disabled_by_admin: block } : x));
            customAlert(block ? '⛔️ أوقفت البوابة وأُشعر التاجر' : '✅ أعيد تفعيل البوابة وأُشعر التاجر');
        }
    };

    const statCard = (icon: string, label: string, value: string, grad: string) => (
        <div style={{ background: grad, borderRadius: 20, padding: '18px 20px', color: '#fff' }}>
            <div style={{ fontSize: '1.4rem' }}>{icon}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, marginTop: 6 }}>{value}</div>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, opacity: 0.9, marginTop: 2 }}>{label}</div>
        </div>
    );

    return (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* رأس الصفحة + مفتاح الإيقاف الشامل */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <h2 style={{ margin: 0, fontWeight: 900, fontSize: '1.3rem', color: 'var(--text-primary)' }}>🧾 فواتير الموقع — الدفع المباشر</h2>
                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        سجل مرجعي خفيف لكل عملية دفع إلكتروني (المال ينتقل للتاجر مباشرة — 0% عمولة). التوليد عند الطلب فقط.
                    </p>
                </div>
                <button onClick={toggleDirectPay}
                    style={{
                        padding: '12px 18px', borderRadius: 14, border: 'none', cursor: 'pointer', fontWeight: 900, fontSize: '0.85rem',
                        background: directPayOn ? 'linear-gradient(135deg, #059669, #0d9488)' : 'var(--gray-200)',
                        color: directPayOn ? '#fff' : 'var(--text-secondary)',
                    }}>
                    {directPayOn === null ? '…' : directPayOn ? '🟢 الدفع المباشر: مفعّل — اضغط للإيقاف' : '⚪️ الدفع المباشر: موقوف — اضغط للتفعيل'}
                </button>
            </div>

            {/* بطاقات المجاميع — تجميع على الفهارس دون جلب صفوف */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {statCard('🧮', 'عدد العمليات (حسب الفلتر)', String(stats?.count ?? '—'), 'linear-gradient(135deg, #0d9488, #059669)')}
                {statCard('💰', 'إجمالي المبالغ (ر.س)', stats ? stats.total.toFixed(2) : '—', 'linear-gradient(135deg, #6366f1, #8b5cf6)')}
                {statCard('🏪', 'بوابات التجار المربوطة', String(gateways.length), 'linear-gradient(135deg, #f59e0b, #f97316)')}
            </div>

            {/* الفلاتر */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div><label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 }}>من تاريخ</label>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} /></div>
                <div><label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 }}>إلى تاريخ</label>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} /></div>
                <div><label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 }}>التاجر</label>
                    <select value={merchantFilter} onChange={e => setMerchantFilter(e.target.value)} style={{ ...inputStyle, minWidth: 140 }}>
                        <option value="">الكل</option>
                        {gateways.map(g => <option key={g.merchant_id} value={g.merchant_id}>{g.store_name || g.merchant_id}</option>)}
                    </select></div>
                <div><label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 }}>البوابة</label>
                    <select value={providerFilter} onChange={e => setProviderFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                        <option value="">الكل</option>
                        {Object.entries(PROVIDER_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                <div><label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 }}>الحالة</label>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                        <option value="">الكل</option>
                        {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                <button onClick={exportCsv} disabled={exporting}
                    style={{ padding: '10px 16px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '0.8rem', cursor: 'pointer', opacity: exporting ? 0.6 : 1 }}>
                    {exporting ? '⏳ جاري التصدير…' : '📥 تصدير CSV (بحد شهر)'}
                </button>
            </div>

            {/* الجدول — keyset pagination */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--body-bg)' }}>
                                {['#', 'التاريخ', 'المتجر', 'العميل', 'الحجز', 'المبلغ', 'البوابة', 'الحالة', 'PDF'].map(h => (
                                    <th key={h} style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 900, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', fontWeight: 800, color: 'var(--text-secondary)' }}>⏳ جاري التحميل…</td></tr>
                            ) : rows.length === 0 ? (
                                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', fontWeight: 800, color: 'var(--text-secondary)' }}>
                                    لا توجد عمليات دفع بعد — بمجرد ربط أول تاجر بوابته ودفع أول عميل، تظهر العمليات هنا تلقائياً.
                                </td></tr>
                            ) : rows.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '10px', fontWeight: 800, color: 'var(--text-secondary)' }}>{r.id}</td>
                                    <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: 700 }}>{fmtDate(r.created_at)}</td>
                                    <td style={{ padding: '10px', fontWeight: 800, color: 'var(--text-primary)' }}>{r.merchant_name || r.merchant_id}</td>
                                    <td style={{ padding: '10px', fontWeight: 700, color: 'var(--text-secondary)' }}>{r.buyer_name || '—'}</td>
                                    <td style={{ padding: '10px', fontFamily: 'monospace', fontWeight: 800, color: 'var(--text-primary)' }}>{r.booking_barcode}</td>
                                    <td style={{ padding: '10px', fontWeight: 900, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{Number(r.amount).toFixed(2)} ر.س</td>
                                    <td style={{ padding: '10px', fontWeight: 800, color: 'var(--text-primary)' }}>{PROVIDER_AR[r.provider] || r.provider}</td>
                                    <td style={{ padding: '10px' }}>
                                        <span style={{
                                            padding: '4px 10px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 900,
                                            background: r.status === 'paid' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                                            color: r.status === 'paid' ? '#059669' : '#b45309',
                                        }}>{STATUS_AR[r.status] || r.status}</span>
                                    </td>
                                    <td style={{ padding: '10px' }}>
                                        <button onClick={() => printRow(r)} title="فاتورة PDF — تتولد لحظة الضغط فقط"
                                            style={{ border: 'none', background: 'var(--gray-100)', borderRadius: 10, padding: '6px 10px', cursor: 'pointer', fontWeight: 800 }}>🧾</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {hasMore && !loading && (
                    <button onClick={loadMore} disabled={loadingMore}
                        style={{ width: '100%', padding: 14, border: 'none', borderTop: '1px solid var(--border-color)', background: 'var(--body-bg)', color: 'var(--primary)', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer' }}>
                        {loadingMore ? '⏳ …' : '⬇️ تحميل 50 عملية إضافية'}
                    </button>
                )}
            </div>

            {/* بوابات التجار — إيقاف/تفعيل إداري */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)' }}>🏪 بوابات التجار المربوطة</h3>
                {gateways.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        لا يوجد تجار ربطوا بواباتهم بعد — بطاقة «💳 بوابة الدفع» متاحة الآن في لوحة كل تاجر.
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {gateways.map(g => (
                            <div key={g.merchant_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border-color)', background: 'var(--body-bg)', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 180 }}>
                                    <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{g.store_name || g.merchant_id}</div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {PROVIDER_AR[g.provider] || g.provider} · طرق الدفع: {g.payment_modes === 'both' ? 'الاثنان' : g.payment_modes === 'online' ? 'إلكتروني فقط' : 'عند الاستلام'}
                                        {g.key_last4 ? ` · سر ••••${g.key_last4}` : ''}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    {g.is_enabled
                                        ? <span style={{ fontSize: '0.66rem', fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.15)', color: '#059669' }}>مفعّلة</span>
                                        : <span style={{ fontSize: '0.66rem', fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'var(--gray-100)', color: 'var(--text-secondary)' }}>غير مفعّلة</span>}
                                    {g.verified_at
                                        ? <span style={{ fontSize: '0.66rem', fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.15)', color: '#059669' }}>✓ مختبرة</span>
                                        : <span style={{ fontSize: '0.66rem', fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>لم تُختبر</span>}
                                    {g.fail_count >= 5 && <span style={{ fontSize: '0.66rem', fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'var(--danger-light)', color: 'var(--danger)' }}>فشل متكرر</span>}
                                    <button onClick={() => toggleGatewayBlock(g)}
                                        style={{
                                            padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 900, fontSize: '0.72rem',
                                            background: g.disabled_by_admin ? '#059669' : 'var(--danger)', color: '#fff',
                                        }}>
                                        {g.disabled_by_admin ? '✅ إعادة تفعيل' : '⛔️ إيقاف إداري'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminInvoices;
