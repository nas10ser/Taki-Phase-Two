/**
 * AdminTax v12.15 — تبويب «الزكاة والضريبة» 🧾
 *
 * نظام متكامل يحسب تلقائياً من مدفوعات الاشتراكات الحقيقية (subscription_payments):
 *  1. عدّاد التسجيل الإلزامي في ضريبة القيمة المضافة (حد ٣٧٥,٠٠٠ ر.س / ١٢ شهراً)
 *     مع إرشاد واضح «متى أسجل في هيئة الزكاة والضريبة والجمارك».
 *  2. جدول شهري (آخر ١٢ شهراً): الإيراد، الضريبة، الصافي — مع تصدير CSV.
 *  3. تقدير الزكاة السنوي (٢٫٥٪) مع تنويه أن الوعاء النهائي يحدده المحاسب.
 *  4. فواتير جاهزة للطباعة/التحميل لكل دفعة — قبل التسجيل الضريبي تصدر «فاتورة»
 *     عادية بلا ضريبة (هذا هو النظامي)، وبعد تفعيل الضريبة تصدر «فاتورة ضريبية
 *     مبسطة» ببيانات QR بصيغة ZATCA TLV (متوافقة مع متطلبات الفوترة الإلكترونية).
 *
 * الإعدادات تُخزَّن في platform_settings تحت المفتاح 'tax_settings'.
 * الطباعة عبر نافذة جديدة بلا سكربتات (CSP-safe — style-src يسمح inline).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { adminService } from '../../services/adminService';
import { ExportButton } from '../../components/admin/ExportButton';
import { CsvColumn } from '../../utils/csvExport';

// ─── أنواع ───────────────────────────────────────────────────────────────────
interface TaxSettings {
    entity_name: string;          // اسم المنشأة على الفاتورة
    cr_number: string;            // السجل التجاري / وثيقة العمل الحر
    vat_number: string;           // الرقم الضريبي (بعد التسجيل)
    vat_enabled: boolean;         // فعِّلها فقط بعد التسجيل الرسمي في الهيئة
    prices_include_vat: boolean;  // أسعار الباقات شاملة الضريبة؟
    vat_rate: number;             // ١٥٪ في السعودية
    zakat_rate: number;           // ٢٫٥٪ تقديري
}

const DEFAULT_SETTINGS: TaxSettings = {
    entity_name: 'TAKI — تاكي',
    cr_number: '',
    vat_number: '',
    vat_enabled: false,
    prices_include_vat: true,
    vat_rate: 15,
    zakat_rate: 2.5,
};

interface PaymentRow {
    id: string;
    merchant_id: string;
    plan_id: string | null;
    amount: number;
    currency: string | null;
    status: string | null;
    branches_count: number | null;
    period_start: string | null;
    period_end: string | null;
    discount_percent: number | null;
    paid_at: string | null;
    created_at: string;
}

interface MonthRow { key: string; label: string; count: number; gross: number; vat: number; net: number; }

// حدود التسجيل في ضريبة القيمة المضافة (SAR / آخر ١٢ شهراً) — نظام الهيئة.
const VAT_MANDATORY = 375_000;
const VAT_VOLUNTARY = 187_500;

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const isPaid = (p: PaymentRow): boolean =>
    !!p.paid_at || ['paid', 'succeeded', 'success', 'completed'].includes(String(p.status || '').toLowerCase());

const fmt = (n: number): string => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 });

// ─── ZATCA TLV (المرحلة الأولى من الفوترة الإلكترونية) ───────────────────────
// Tag1 اسم البائع، Tag2 الرقم الضريبي، Tag3 التاريخ ISO، Tag4 الإجمالي شامل
// الضريبة، Tag5 مبلغ الضريبة — كل حقل TLV ثم base64 للمجموع.
function zatcaTlvBase64(seller: string, vat: string, iso: string, total: string, vatAmt: string): string {
    const enc = new TextEncoder();
    const parts: number[] = [];
    [seller, vat, iso, total, vatAmt].forEach((v, i) => {
        const bytes = enc.encode(v);
        parts.push(i + 1, bytes.length, ...Array.from(bytes));
    });
    let bin = '';
    for (const b of parts) bin += String.fromCharCode(b);
    try { return btoa(bin); } catch { return ''; }
}

// ─── المكوّن ─────────────────────────────────────────────────────────────────
const AdminTax: React.FC = () => {
    const { customAlert } = useApp();
    const [settings, setSettings] = useState<TaxSettings>(DEFAULT_SETTINGS);
    const [payments, setPayments] = useState<PaymentRow[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [s, { data: pays }] = await Promise.all([
            adminService.getPlatformSetting<Partial<TaxSettings>>('tax_settings'),
            supabase.from('subscription_payments').select('*').order('created_at', { ascending: false }).limit(2000),
        ]);
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
        const rows = (pays || []) as PaymentRow[];
        setPayments(rows);
        // أسماء التجار للفواتير (استعلام واحد).
        const ids = Array.from(new Set(rows.map(r => r.merchant_id).filter(Boolean)));
        if (ids.length) {
            const { data: us } = await supabase.from('users').select('id, name, shop').in('id', ids.slice(0, 500));
            const m: Record<string, string> = {};
            (us || []).forEach((u: any) => { m[u.id] = u.shop || u.name || u.id; });
            setNames(m);
        }
        setLoading(false);
        setDirty(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const upd = (patch: Partial<TaxSettings>) => { setSettings(prev => ({ ...prev, ...patch })); setDirty(true); };

    const saveSettings = async () => {
        if (saving) return;
        setSaving(true);
        const res = await adminService.setPlatformSetting('tax_settings', settings, 'إعدادات الزكاة والضريبة والفواتير (v12.15)');
        setSaving(false);
        if (!res.success) { await customAlert('❌ تعذّر الحفظ: ' + (res.error || '')); return; }
        setDirty(false);
        await customAlert('✅ حُفظت إعدادات الزكاة والضريبة.');
    };

    // ─── حسابات ──────────────────────────────────────────────────────────────
    const paid = useMemo(() => payments.filter(isPaid), [payments]);

    // الضريبة من مبلغ إجمالي حسب الإعدادات (شامل/غير شامل + مفعَّلة أم لا).
    const vatOf = useCallback((gross: number): number => {
        if (!settings.vat_enabled) return 0;
        const r = settings.vat_rate;
        return settings.prices_include_vat ? (gross * r) / (100 + r) : (gross * r) / 100;
    }, [settings]);

    const rev12m = useMemo(() => {
        const cutoff = Date.now() - 365 * 86400000;
        return paid.reduce((a, p) => {
            const t = new Date(p.paid_at || p.created_at).getTime();
            return t >= cutoff ? a + (Number(p.amount) || 0) : a;
        }, 0);
    }, [paid]);

    const monthly = useMemo<MonthRow[]>(() => {
        const rows: MonthRow[] = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            rows.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`, count: 0, gross: 0, vat: 0, net: 0 });
        }
        const idx = new Map(rows.map((r, i) => [r.key, i]));
        for (const p of paid) {
            const d = new Date(p.paid_at || p.created_at);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const i = idx.get(k);
            if (i === undefined) continue;
            const gross = Number(p.amount) || 0;
            const vat = vatOf(gross);
            rows[i].count += 1;
            rows[i].gross += gross;
            rows[i].vat += vat;
            rows[i].net += settings.prices_include_vat ? gross - vat : gross;
        }
        return rows;
    }, [paid, vatOf, settings.prices_include_vat]);

    const totals = useMemo(() => monthly.reduce(
        (a, r) => ({ count: a.count + r.count, gross: a.gross + r.gross, vat: a.vat + r.vat, net: a.net + r.net }),
        { count: 0, gross: 0, vat: 0, net: 0 }
    ), [monthly]);

    const zakatEst = useMemo(() => (totals.net * (settings.zakat_rate || 2.5)) / 100, [totals.net, settings.zakat_rate]);

    const meter = Math.min(100, (rev12m / VAT_MANDATORY) * 100);
    const meterState = rev12m >= VAT_MANDATORY ? 'over' : rev12m >= VAT_VOLUNTARY ? 'mid' : 'under';

    const csvColumns: CsvColumn<MonthRow>[] = [
        { header: 'الشهر', accessor: r => r.label },
        { header: 'عدد المدفوعات', accessor: r => r.count },
        { header: 'الإيراد الإجمالي (ر.س)', accessor: r => r.gross.toFixed(2) },
        { header: `الضريبة ${settings.vat_rate}% (ر.س)`, accessor: r => r.vat.toFixed(2) },
        { header: 'الصافي (ر.س)', accessor: r => r.net.toFixed(2) },
    ];

    // ─── فاتورة قابلة للطباعة (نافذة بلا سكربتات — التحميل عبر «حفظ كـPDF») ──
    const openInvoice = (p: PaymentRow) => {
        const gross = Number(p.amount) || 0;
        const vat = vatOf(gross);
        const net = settings.prices_include_vat ? gross - vat : gross;
        const total = settings.prices_include_vat ? gross : gross + vat;
        const dt = new Date(p.paid_at || p.created_at);
        const iso = dt.toISOString();
        const isTax = settings.vat_enabled && !!settings.vat_number;
        const tlv = isTax ? zatcaTlvBase64(settings.entity_name, settings.vat_number, iso, total.toFixed(2), vat.toFixed(2)) : '';
        const merchant = names[p.merchant_id] || p.merchant_id;
        const period = p.period_start && p.period_end
            ? `${new Date(p.period_start).toLocaleDateString('ar-SA')} ← ${new Date(p.period_end).toLocaleDateString('ar-SA')}` : '—';
        const w = window.open('', '_blank');
        if (!w) { customAlert('السماح بالنوافذ المنبثقة مطلوب لعرض الفاتورة.'); return; }
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${isTax ? 'فاتورة ضريبية مبسطة' : 'فاتورة'} ${p.id}</title>
<style>
 body{font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:32px;color:#111;background:#fff}
 .inv{max-width:640px;margin:0 auto;border:1px solid #ddd;border-radius:14px;padding:28px}
 h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:12px;margin-bottom:18px}
 table{width:100%;border-collapse:collapse;margin:14px 0} td,th{border:1px solid #e5e5e5;padding:8px 10px;font-size:13px;text-align:right}
 th{background:#f8f8f8} .tot td{font-weight:800;background:#fffbe6}
 .meta{font-size:12px;color:#444;line-height:2}
 .qr{margin-top:14px;font-size:10px;color:#777;word-break:break-all;border:1px dashed #ccc;border-radius:8px;padding:8px}
 .foot{margin-top:16px;font-size:11px;color:#888;text-align:center}
 .badge{display:inline-block;background:#0d9488;color:#fff;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700}
 @media print{body{padding:0}.noprint{display:none}}
</style></head><body><div class="inv">
 <h1>🧾 ${isTax ? 'فاتورة ضريبية مبسطة' : 'فاتورة'} <span class="badge">${isPaid(p) ? 'مدفوعة' : String(p.status || '')}</span></h1>
 <div class="sub">${settings.entity_name}${settings.cr_number ? ' — سجل/وثيقة: ' + settings.cr_number : ''}${isTax ? ' — الرقم الضريبي: ' + settings.vat_number : ''}</div>
 <div class="meta">
  رقم الفاتورة: <b>INV-${p.id}</b><br>
  التاريخ: <b>${dt.toLocaleDateString('ar-SA')} ${dt.toLocaleTimeString('ar-SA')}</b><br>
  العميل (التاجر): <b>${merchant}</b><br>
  البيان: اشتراك باقة مواقع${p.branches_count ? ` (${p.branches_count} مواقع)` : ''} — الفترة: ${period}
 </div>
 <table>
  <tr><th>البند</th><th>المبلغ (ر.س)</th></tr>
  <tr><td>قيمة الاشتراك${settings.prices_include_vat && isTax ? ' (قبل الضريبة)' : ''}</td><td>${net.toFixed(2)}</td></tr>
  ${isTax ? `<tr><td>ضريبة القيمة المضافة ${settings.vat_rate}٪</td><td>${vat.toFixed(2)}</td></tr>` : ''}
  <tr class="tot"><td>الإجمالي${isTax ? ' شامل الضريبة' : ''}</td><td>${total.toFixed(2)}</td></tr>
 </table>
 ${isTax ? `<div class="qr"><b>ZATCA QR (TLV Base64):</b><br>${tlv}</div>` : '<div class="qr">منشأة غير مسجلة في ضريبة القيمة المضافة بعد — لا تُحصَّل ضريبة على هذه الفاتورة.</div>'}
 <div class="foot">فاتورة صادرة إلكترونياً من منصة تاكي — اطبع أو «حفظ كـPDF» من نافذة الطباعة.</div>
 <div class="noprint" style="text-align:center;margin-top:14px"><button onclick="window.print()" style="padding:10px 26px;border-radius:10px;border:0;background:#0d9488;color:#fff;font-weight:800;font-size:14px">🖨 طباعة / حفظ PDF</button></div>
</div></body></html>`);
        w.document.close();
    };

    // ─── واجهة ───────────────────────────────────────────────────────────────
    const card = 'bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm';
    const inputCls = 'w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)] outline-none focus:border-teal-500';

    if (loading) {
        return <div className="space-y-3 animate-pulse">{[0, 1, 2].map(i => <div key={i} className="h-36 bg-[var(--gray-100)] rounded-2xl" />)}</div>;
    }

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header */}
            <section className={card} style={{ borderTop: '3px solid #0d9488' }}>
                <h2 className="font-extrabold text-lg text-[var(--text-primary)]">🧾 الزكاة والضريبة</h2>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1">
                    يحسب هذا النظام تلقائياً من مدفوعات الاشتراكات الفعلية: عدّاد التسجيل الضريبي، جدول شهري جاهز للتصدير،
                    تقدير الزكاة، وفواتير قابلة للطباعة. قبل التسجيل في الهيئة تصدر الفواتير <b>بلا ضريبة</b> (وهذا هو النظامي) —
                    وبعد التسجيل فعِّل الضريبة وأدخل رقمك الضريبي فتتحول تلقائياً إلى <b>فواتير ضريبية مبسطة</b> ببيانات QR متوافقة مع الهيئة.
                </p>
            </section>

            {/* متى أسجل؟ */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-2">📏 متى أسجل في هيئة الزكاة والضريبة والجمارك؟</h3>
                <div className="text-xs text-[var(--text-secondary)] leading-loose">
                    <b>الزكاة:</b> بمجرد إصدار السجل التجاري تُسجَّل منشأتك لدى الهيئة وتقدّم إقراراً زكوياً سنوياً (خلال ١٢٠ يوماً من نهاية السنة المالية).<br />
                    <b>ضريبة القيمة المضافة (١٥٪):</b> التسجيل <b>إلزامي</b> إذا تجاوزت إيراداتك الخاضعة {fmt(VAT_MANDATORY)} ر.س خلال ١٢ شهراً،
                    و<b>اختياري</b> من {fmt(VAT_VOLUNTARY)} ر.س. تحت ذلك: لا تسجيل ولا تحصيل ضريبة.
                </div>
                <div className="mt-3">
                    <div className="flex justify-between text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                        <span>إيراد آخر ١٢ شهراً: {fmt(rev12m)} ر.س</span>
                        <span>حد الإلزام: {fmt(VAT_MANDATORY)} ر.س</span>
                    </div>
                    <div className="h-3 rounded-full bg-[var(--gray-100)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${meter}%`, background: meterState === 'over' ? '#ef4444' : meterState === 'mid' ? '#f59e0b' : '#10b981', transition: 'width .4s' }} />
                    </div>
                    <div className="text-[11px] font-bold mt-2" style={{ color: meterState === 'over' ? '#ef4444' : meterState === 'mid' ? '#b45309' : '#059669' }}>
                        {meterState === 'over' && '🔴 تجاوزت حد التسجيل الإلزامي — سجِّل في الهيئة خلال ٣٠ يوماً وفعِّل الضريبة هنا فوراً.'}
                        {meterState === 'mid' && '🟠 تجاوزت حد التسجيل الاختياري — يمكنك التسجيل الآن (مفيد لاسترداد ضريبة المدخلات)، والإلزام عند ٣٧٥ ألف.'}
                        {meterState === 'under' && '🟢 أنت تحت حدود التسجيل — لا يلزمك تسجيل ضريبي حالياً، وسيتحول العدّاد تلقائياً عند الاقتراب.'}
                    </div>
                </div>
            </section>

            {/* الإعدادات */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-3">⚙️ إعدادات الفواتير والضريبة</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block"><span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">اسم المنشأة (يظهر على الفاتورة)</span>
                        <input className={inputCls} value={settings.entity_name} onChange={e => upd({ entity_name: e.target.value })} /></label>
                    <label className="block"><span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">السجل التجاري / وثيقة العمل الحر</span>
                        <input className={inputCls} value={settings.cr_number} onChange={e => upd({ cr_number: e.target.value })} placeholder="اختياري" /></label>
                    <label className="block"><span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">الرقم الضريبي (بعد التسجيل)</span>
                        <input className={inputCls} value={settings.vat_number} onChange={e => upd({ vat_number: e.target.value })} placeholder="3XXXXXXXXXXXXXX3" /></label>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                    <button onClick={() => upd({ vat_enabled: !settings.vat_enabled })}
                        className={`px-3 py-2 rounded-xl text-xs font-extrabold ${settings.vat_enabled ? 'bg-teal-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {settings.vat_enabled ? '✅ الضريبة مفعّلة (مسجَّل في الهيئة)' : '⭕ الضريبة غير مفعّلة (قبل التسجيل)'}
                    </button>
                    <button onClick={() => upd({ prices_include_vat: !settings.prices_include_vat })}
                        className={`px-3 py-2 rounded-xl text-xs font-extrabold ${settings.prices_include_vat ? 'bg-blue-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {settings.prices_include_vat ? 'الأسعار شاملة الضريبة' : 'الضريبة تُضاف فوق السعر'}
                    </button>
                    <button onClick={saveSettings} disabled={saving || !dirty}
                        className="px-5 py-2 rounded-xl text-xs font-extrabold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#0d9488,#0f766e)' }}>
                        {saving ? 'جاري الحفظ…' : dirty ? '💾 حفظ الإعدادات' : '✓ محفوظة'}
                    </button>
                </div>
                {settings.vat_enabled && !settings.vat_number && (
                    <div className="text-[11px] font-bold text-amber-600 mt-2">⚠️ الضريبة مفعّلة بلا رقم ضريبي — أدخل الرقم ليظهر على الفواتير مع QR.</div>
                )}
            </section>

            {/* الجدول الشهري */}
            <section className={card}>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-extrabold text-sm text-[var(--text-primary)]">📅 الجدول الشهري (آخر ١٢ شهراً)</h3>
                    <ExportButton rows={monthly} columns={csvColumns} filenameStem="taki-tax-monthly" label="تصدير CSV" tooltip="تنزيل الجدول الشهري كملف CSV جاهز للمحاسب" />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead><tr className="text-[var(--text-secondary)]">
                            <th className="text-right py-2 px-2 font-extrabold">الشهر</th>
                            <th className="text-right py-2 px-2 font-extrabold">مدفوعات</th>
                            <th className="text-right py-2 px-2 font-extrabold">الإيراد</th>
                            <th className="text-right py-2 px-2 font-extrabold">الضريبة {settings.vat_enabled ? `${settings.vat_rate}٪` : '(غير مفعّلة)'}</th>
                            <th className="text-right py-2 px-2 font-extrabold">الصافي</th>
                        </tr></thead>
                        <tbody>
                            {monthly.map(r => (
                                <tr key={r.key} className="border-t border-[var(--border-color)] text-[var(--text-primary)] font-bold">
                                    <td className="py-2 px-2">{r.label}</td>
                                    <td className="py-2 px-2">{r.count}</td>
                                    <td className="py-2 px-2">{fmt(r.gross)} ر.س</td>
                                    <td className="py-2 px-2">{fmt(r.vat)} ر.س</td>
                                    <td className="py-2 px-2">{fmt(r.net)} ر.س</td>
                                </tr>
                            ))}
                            <tr className="border-t-2 border-[var(--border-color)] font-extrabold text-[var(--text-primary)] bg-[var(--gray-100)]">
                                <td className="py-2 px-2">الإجمالي</td>
                                <td className="py-2 px-2">{totals.count}</td>
                                <td className="py-2 px-2">{fmt(totals.gross)} ر.س</td>
                                <td className="py-2 px-2">{fmt(totals.vat)} ر.س</td>
                                <td className="py-2 px-2">{fmt(totals.net)} ر.س</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                {totals.count === 0 && (
                    <div className="text-[11px] text-[var(--text-secondary)] font-bold mt-2">
                        لا توجد مدفوعات مسجلة بعد — الجدول يمتلئ تلقائياً فور تفعيل بوابة الدفع الحقيقية.
                    </div>
                )}
            </section>

            {/* الزكاة */}
            <section className={card} style={{ borderTop: '3px solid #f59e0b' }}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-1">🕌 تقدير الزكاة السنوي</h3>
                <div className="text-2xl font-black" style={{ color: '#b45309' }}>{fmt(zakatEst)} ر.س</div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-1">
                    تقدير مبدئي = {settings.zakat_rate}٪ × صافي إيرادات آخر ١٢ شهراً ({fmt(totals.net)} ر.س).
                    الوعاء الزكوي النظامي يُحسب من قائمة المركز المالي (رأس المال + الأرباح − الأصول الثابتة…) ويعتمده محاسبك في الإقرار السنوي —
                    استخدم هذا الرقم للتخطيط المالي وتجنيب المبلغ شهرياً.
                </p>
            </section>

            {/* الفواتير */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-3">📄 الفواتير (أحدث ٥٠ دفعة)</h3>
                {payments.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-secondary)] font-bold">لا توجد مدفوعات بعد — كل دفعة اشتراك ستظهر هنا بفاتورة جاهزة للطباعة أو الحفظ PDF.</div>
                ) : (
                    <div className="space-y-2">
                        {payments.slice(0, 50).map(p => (
                            <div key={p.id} className="flex items-center gap-2 border border-[var(--border-color)] rounded-xl px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-extrabold text-[var(--text-primary)] truncate">{names[p.merchant_id] || p.merchant_id}</div>
                                    <div className="text-[10px] text-[var(--text-secondary)] font-bold">
                                        {new Date(p.paid_at || p.created_at).toLocaleDateString('ar-SA')} • {fmt(Number(p.amount) || 0)} ر.س •
                                        <span className={isPaid(p) ? 'text-emerald-600' : 'text-amber-600'}> {isPaid(p) ? 'مدفوعة' : (p.status || 'معلّقة')}</span>
                                    </div>
                                </div>
                                <button onClick={() => openInvoice(p)}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-teal-50 text-teal-700 border border-teal-200 active:scale-95">
                                    🖨 فاتورة
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default AdminTax;
