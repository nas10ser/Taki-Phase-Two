/**
 * AdminTax v12.16 — تبويب «الزكاة والضريبة» 🧾 (نظام متكامل بزر واحد)
 *
 * v12.15: عدّاد التسجيل + جدول شهري + تقدير زكاة + فواتير مبيعات للطباعة.
 * v12.16 (طلب ناصر: «نظام متكامل يعمل بزر واحد ويفهم متطلبات الهيئة والاسترداد»):
 *  1. سجلّ فواتير المشتريات/المصروفات (ضريبة المدخلات) — جدول expense_invoices —
 *     هذا هو أساس «استرداد المبالغ الضريبية»: ضريبة مشترياتك تُخصم من ضريبة مبيعاتك.
 *  2. «الإقرار الضريبي بزر واحد»: اختر الربع → زر واحد يولّد تقريراً بنفس بنود
 *     نموذج إقرار الهيئة (مبيعات خاضعة ١٥٪، مشتريات خاضعة، صافي مستحق/مسترد)
 *     جاهزاً للطباعة/PDF، ومعه CSV.
 *  3. «كل فواتير العملاء بزر واحد»: ملف طباعة واحد يضم كل فواتير الفترة
 *     (فاتورة لكل صفحة) — للأرشفة أو تسليم المحاسب.
 *  4. حاسبة الوعاء الزكوي (رأس المال + الأرباح − الأصول الثابتة) تُحفظ بالإعدادات.
 *
 * ملاحظة نظامية مضمّنة بالواجهة: الربط الفعلي API مع «فاتورة» (المرحلة الثانية)
 * يتطلب تسجيلاً ضريبياً سارياً وتفعيل ربط من بوابة الهيئة — كل البيانات هنا مخزّنة
 * بالصيغة الصحيحة بحيث يكون الربط لاحقاً تشغيلاً لا إعادة بناء.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { adminService } from '../../services/adminService';
import { ExportButton } from '../../components/admin/ExportButton';
import { CsvColumn } from '../../utils/csvExport';

// ─── أنواع ───────────────────────────────────────────────────────────────────
interface TaxSettings {
    entity_name: string;
    cr_number: string;
    vat_number: string;
    vat_enabled: boolean;
    prices_include_vat: boolean;
    vat_rate: number;
    zakat_rate: number;
    zakat_capital: number;       // رأس المال — لحاسبة الوعاء
    zakat_profit: number;        // صافي الربح السنوي
    zakat_fixed_assets: number;  // الأصول الثابتة (تُخصم)
}

const DEFAULT_SETTINGS: TaxSettings = {
    entity_name: 'TAKI — تاكي', cr_number: '', vat_number: '',
    vat_enabled: false, prices_include_vat: true, vat_rate: 15, zakat_rate: 2.5,
    zakat_capital: 0, zakat_profit: 0, zakat_fixed_assets: 0,
};

interface PaymentRow {
    id: string; merchant_id: string; plan_id: string | null; amount: number;
    currency: string | null; status: string | null; branches_count: number | null;
    period_start: string | null; period_end: string | null; discount_percent: number | null;
    paid_at: string | null; created_at: string;
}

interface ExpenseRow {
    id: string; invoice_date: string; supplier_name: string; supplier_vat_number: string | null;
    invoice_ref: string | null; description: string | null; category: string | null;
    amount_gross: number; vat_amount: number; created_at: string;
}

interface MonthRow { key: string; label: string; count: number; gross: number; vat: number; net: number; }
interface Quarter { key: string; label: string; start: number; end: number; }

const VAT_MANDATORY = 375_000;
const VAT_VOLUNTARY = 187_500;
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const Q_NAMES = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const EXPENSE_CATS = [
    { id: 'hosting', label: '☁️ استضافة وتقنية' }, { id: 'marketing', label: '📣 تسويق وإعلان' },
    { id: 'equipment', label: '💻 أجهزة ومعدات' }, { id: 'services', label: '🤝 خدمات مهنية' },
    { id: 'other', label: '📦 أخرى' },
];

const isPaid = (p: PaymentRow): boolean =>
    !!p.paid_at || ['paid', 'succeeded', 'success', 'completed'].includes(String(p.status || '').toLowerCase());
const fmt = (n: number): string => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
const catLabel = (id: string | null): string => EXPENSE_CATS.find(c => c.id === id)?.label || '📦 أخرى';

// آخر ٤ أرباع (الحالي أولاً) — الإقرار ربع سنوي للمنشآت تحت ٤٠ مليون ر.س.
function lastQuarters(): Quarter[] {
    const out: Quarter[] = [];
    const now = new Date();
    let y = now.getFullYear(), qi = Math.floor(now.getMonth() / 3);
    for (let k = 0; k < 4; k++) {
        const start = new Date(y, qi * 3, 1).getTime();
        const end = new Date(y, qi * 3 + 3, 1).getTime();
        out.push({ key: `${y}-Q${qi + 1}`, label: `الربع ${Q_NAMES[qi]} ${y} (${AR_MONTHS[qi * 3]}–${AR_MONTHS[qi * 3 + 2]})`, start, end });
        qi--; if (qi < 0) { qi = 3; y--; }
    }
    return out;
}

// ZATCA TLV (المرحلة الأولى) — Tag1..5 ثم base64.
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

const PRINT_CSS = `
 body{font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:32px;color:#111;background:#fff}
 .inv{max-width:640px;margin:0 auto 24px;border:1px solid #ddd;border-radius:14px;padding:28px}
 .pb{page-break-after:always}
 h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:12px;margin-bottom:18px}
 table{width:100%;border-collapse:collapse;margin:14px 0} td,th{border:1px solid #e5e5e5;padding:8px 10px;font-size:13px;text-align:right}
 th{background:#f8f8f8} .tot td{font-weight:800;background:#fffbe6} .ref td{font-weight:800;background:#ecfdf5}
 .meta{font-size:12px;color:#444;line-height:2}
 .qr{margin-top:14px;font-size:10px;color:#777;word-break:break-all;border:1px dashed #ccc;border-radius:8px;padding:8px}
 .foot{margin-top:16px;font-size:11px;color:#888;text-align:center}
 .badge{display:inline-block;background:#0d9488;color:#fff;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700}
 @media print{body{padding:0}.noprint{display:none}.inv{border:none}}
`;

// ─── المكوّن ─────────────────────────────────────────────────────────────────
const AdminTax: React.FC = () => {
    const { customAlert, customConfirm, user } = useApp();
    const [settings, setSettings] = useState<TaxSettings>(DEFAULT_SETTINGS);
    const [payments, setPayments] = useState<PaymentRow[]>([]);
    const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const quarters = useMemo(lastQuarters, []);
    const [qKey, setQKey] = useState(quarters[0].key);
    // نموذج فاتورة مشتريات جديدة
    const [exp, setExp] = useState({ date: new Date().toISOString().slice(0, 10), supplier: '', vatNo: '', ref: '', desc: '', cat: 'hosting', gross: '', vat: '' });
    const [addingExp, setAddingExp] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [s, { data: pays }, { data: exps }] = await Promise.all([
            adminService.getPlatformSetting<Partial<TaxSettings>>('tax_settings'),
            supabase.from('subscription_payments').select('*').order('created_at', { ascending: false }).limit(2000),
            supabase.from('expense_invoices').select('*').order('invoice_date', { ascending: false }).limit(1000),
        ]);
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
        const rows = (pays || []) as PaymentRow[];
        setPayments(rows);
        setExpenses((exps || []) as ExpenseRow[]);
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
        const res = await adminService.setPlatformSetting('tax_settings', settings, 'إعدادات الزكاة والضريبة والفواتير (v12.16)');
        setSaving(false);
        if (!res.success) { await customAlert('❌ تعذّر الحفظ: ' + (res.error || '')); return; }
        setDirty(false);
        await customAlert('✅ حُفظت إعدادات الزكاة والضريبة.');
    };

    // ─── حسابات المبيعات ─────────────────────────────────────────────────────
    const paid = useMemo(() => payments.filter(isPaid), [payments]);
    const vatOf = useCallback((gross: number): number => {
        if (!settings.vat_enabled) return 0;
        const r = settings.vat_rate;
        return settings.prices_include_vat ? (gross * r) / (100 + r) : (gross * r) / 100;
    }, [settings]);

    const rev12m = useMemo(() => {
        const cutoff = Date.now() - 365 * 86400000;
        return paid.reduce((a, p) => (new Date(p.paid_at || p.created_at).getTime() >= cutoff ? a + (Number(p.amount) || 0) : a), 0);
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
            const i = idx.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            if (i === undefined) continue;
            const gross = Number(p.amount) || 0;
            const vat = vatOf(gross);
            rows[i].count += 1; rows[i].gross += gross; rows[i].vat += vat;
            rows[i].net += settings.prices_include_vat ? gross - vat : gross;
        }
        return rows;
    }, [paid, vatOf, settings.prices_include_vat]);

    const totals = useMemo(() => monthly.reduce(
        (a, r) => ({ count: a.count + r.count, gross: a.gross + r.gross, vat: a.vat + r.vat, net: a.net + r.net }),
        { count: 0, gross: 0, vat: 0, net: 0 }
    ), [monthly]);

    // ─── الإقرار الربع سنوي (زر واحد) ────────────────────────────────────────
    const quarter = useMemo(() => quarters.find(q => q.key === qKey) || quarters[0], [quarters, qKey]);
    const vatReturn = useMemo(() => {
        const inQ = (t: number) => t >= quarter.start && t < quarter.end;
        let salesGross = 0, salesVat = 0, salesCount = 0;
        for (const p of paid) {
            const t = new Date(p.paid_at || p.created_at).getTime();
            if (!inQ(t)) continue;
            const g = Number(p.amount) || 0;
            salesGross += g; salesVat += vatOf(g); salesCount += 1;
        }
        const salesNet = settings.prices_include_vat ? salesGross - salesVat : salesGross;
        let purchGross = 0, purchVat = 0, purchCount = 0;
        for (const e of expenses) {
            const t = new Date(e.invoice_date + 'T00:00:00').getTime();
            if (!inQ(t)) continue;
            purchGross += Number(e.amount_gross) || 0; purchVat += Number(e.vat_amount) || 0; purchCount += 1;
        }
        const netDue = salesVat - purchVat;   // موجب = تدفع للهيئة، سالب = رصيد استرداد
        return { salesGross, salesVat, salesNet, salesCount, purchGross, purchVat, purchNet: purchGross - purchVat, purchCount, netDue };
    }, [paid, expenses, quarter, vatOf, settings.prices_include_vat]);

    // ─── الزكاة (حاسبة الوعاء) ───────────────────────────────────────────────
    const zakatBase = useMemo(() => Math.max(0, (settings.zakat_capital || 0) + (settings.zakat_profit || 0) - (settings.zakat_fixed_assets || 0)), [settings]);
    const zakatDue = useMemo(() => (zakatBase * (settings.zakat_rate || 2.5)) / 100, [zakatBase, settings.zakat_rate]);
    const zakatQuick = useMemo(() => (totals.net * (settings.zakat_rate || 2.5)) / 100, [totals.net, settings.zakat_rate]);

    const meter = Math.min(100, (rev12m / VAT_MANDATORY) * 100);
    const meterState = rev12m >= VAT_MANDATORY ? 'over' : rev12m >= VAT_VOLUNTARY ? 'mid' : 'under';

    // ─── فواتير المشتريات (CRUD) ─────────────────────────────────────────────
    const suggestedVat = (grossStr: string): string => {
        const g = parseFloat(grossStr);
        if (!Number.isFinite(g) || g <= 0) return '';
        return (Math.round(((g * settings.vat_rate) / (100 + settings.vat_rate)) * 100) / 100).toFixed(2);
    };
    const addExpense = async () => {
        const gross = parseFloat(exp.gross);
        if (!exp.supplier.trim() || !Number.isFinite(gross) || gross <= 0) {
            await customAlert('أدخل اسم المورد ومبلغ الفاتورة على الأقل.'); return;
        }
        const vat = parseFloat(exp.vat);
        setAddingExp(true);
        const { error } = await supabase.from('expense_invoices').insert({
            invoice_date: exp.date, supplier_name: exp.supplier.trim(),
            supplier_vat_number: exp.vatNo.trim() || null, invoice_ref: exp.ref.trim() || null,
            description: exp.desc.trim() || null, category: exp.cat,
            amount_gross: gross, vat_amount: Number.isFinite(vat) && vat >= 0 ? vat : parseFloat(suggestedVat(exp.gross)) || 0,
            created_by: (user as any)?.id || null,
        });
        setAddingExp(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setExp({ date: new Date().toISOString().slice(0, 10), supplier: '', vatNo: '', ref: '', desc: '', cat: exp.cat, gross: '', vat: '' });
        load();
    };
    const removeExpense = async (id: string) => {
        const ok = await customConfirm('حذف فاتورة المشتريات هذه؟');
        if (!ok) return;
        await supabase.from('expense_invoices').delete().eq('id', id);
        load();
    };

    // ─── الطباعة ─────────────────────────────────────────────────────────────
    const invoiceHtml = (p: PaymentRow, pageBreak: boolean): string => {
        const gross = Number(p.amount) || 0;
        const vat = vatOf(gross);
        const net = settings.prices_include_vat ? gross - vat : gross;
        const total = settings.prices_include_vat ? gross : gross + vat;
        const dt = new Date(p.paid_at || p.created_at);
        const isTax = settings.vat_enabled && !!settings.vat_number;
        const tlv = isTax ? zatcaTlvBase64(settings.entity_name, settings.vat_number, dt.toISOString(), total.toFixed(2), vat.toFixed(2)) : '';
        const merchant = names[p.merchant_id] || p.merchant_id;
        const period = p.period_start && p.period_end
            ? `${new Date(p.period_start).toLocaleDateString('ar-SA')} ← ${new Date(p.period_end).toLocaleDateString('ar-SA')}` : '—';
        return `<div class="inv${pageBreak ? ' pb' : ''}">
 <h1>🧾 ${isTax ? 'فاتورة ضريبية مبسطة' : 'فاتورة'} <span class="badge">${isPaid(p) ? 'مدفوعة' : String(p.status || '')}</span></h1>
 <div class="sub">${settings.entity_name}${settings.cr_number ? ' — سجل/وثيقة: ' + settings.cr_number : ''}${isTax ? ' — الرقم الضريبي: ' + settings.vat_number : ''}</div>
 <div class="meta">رقم الفاتورة: <b>INV-${p.id}</b><br>التاريخ: <b>${dt.toLocaleDateString('ar-SA')} ${dt.toLocaleTimeString('ar-SA')}</b><br>
  العميل (التاجر): <b>${merchant}</b><br>البيان: اشتراك باقة مواقع${p.branches_count ? ` (${p.branches_count} مواقع)` : ''} — الفترة: ${period}</div>
 <table><tr><th>البند</th><th>المبلغ (ر.س)</th></tr>
  <tr><td>قيمة الاشتراك${settings.prices_include_vat && isTax ? ' (قبل الضريبة)' : ''}</td><td>${net.toFixed(2)}</td></tr>
  ${isTax ? `<tr><td>ضريبة القيمة المضافة ${settings.vat_rate}٪</td><td>${vat.toFixed(2)}</td></tr>` : ''}
  <tr class="tot"><td>الإجمالي${isTax ? ' شامل الضريبة' : ''}</td><td>${total.toFixed(2)}</td></tr></table>
 ${isTax ? `<div class="qr"><b>ZATCA QR (TLV Base64):</b><br>${tlv}</div>` : '<div class="qr">منشأة غير مسجلة في ضريبة القيمة المضافة بعد — لا تُحصَّل ضريبة على هذه الفاتورة.</div>'}
 <div class="foot">فاتورة صادرة إلكترونياً من منصة تاكي</div></div>`;
    };

    const openPrintWindow = (title: string, bodyHtml: string) => {
        const w = window.open('', '_blank');
        if (!w) { customAlert('السماح بالنوافذ المنبثقة مطلوب للطباعة.'); return; }
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head><body>
${bodyHtml}
<div class="noprint" style="text-align:center;margin:14px"><button onclick="window.print()" style="padding:10px 26px;border-radius:10px;border:0;background:#0d9488;color:#fff;font-weight:800;font-size:14px">🖨 طباعة / حفظ PDF</button></div>
</body></html>`);
        w.document.close();
    };

    const openInvoice = (p: PaymentRow) => openPrintWindow(`فاتورة ${p.id}`, invoiceHtml(p, false));

    // زر واحد: كل فواتير العملاء في الفترة المختارة (فاتورة لكل صفحة).
    const printAllInvoices = () => {
        const inQ = paid.filter(p => { const t = new Date(p.paid_at || p.created_at).getTime(); return t >= quarter.start && t < quarter.end; });
        if (!inQ.length) { customAlert(`لا توجد فواتير مدفوعة في ${quarter.label}.`); return; }
        const html = inQ.map((p, i) => invoiceHtml(p, i < inQ.length - 1)).join('\n');
        openPrintWindow(`فواتير ${quarter.label}`, `<div class="sub" style="text-align:center;font-weight:800">📚 كل فواتير العملاء — ${quarter.label} (${inQ.length} فاتورة)</div>` + html);
    };

    // زر واحد: تقرير الإقرار الضريبي بصيغة بنود نموذج الهيئة.
    const printVatReturn = () => {
        const r = vatReturn;
        const refundable = r.netDue < 0;
        const html = `<div class="inv">
 <h1>⚖️ تقرير الإقرار الضريبي — ${quarter.label}</h1>
 <div class="sub">${settings.entity_name}${settings.cr_number ? ' — سجل/وثيقة: ' + settings.cr_number : ''}${settings.vat_number ? ' — الرقم الضريبي: ' + settings.vat_number : ' — (غير مسجّل ضريبياً بعد)'}</div>
 <table>
  <tr><th>البند (مطابق لنموذج إقرار الهيئة)</th><th>المبلغ (ر.س)</th><th>الضريبة (ر.س)</th></tr>
  <tr><td>١. المبيعات الخاضعة للنسبة الأساسية ١٥٪ (${r.salesCount} فاتورة)</td><td>${r.salesNet.toFixed(2)}</td><td>${r.salesVat.toFixed(2)}</td></tr>
  <tr><td>٢. المبيعات الصفرية / المعفاة</td><td>0.00</td><td>—</td></tr>
  <tr><td>٣. إجمالي المبيعات</td><td>${r.salesNet.toFixed(2)}</td><td>${r.salesVat.toFixed(2)}</td></tr>
  <tr><td>٤. المشتريات الخاضعة للنسبة الأساسية ١٥٪ (${r.purchCount} فاتورة)</td><td>${r.purchNet.toFixed(2)}</td><td>${r.purchVat.toFixed(2)}</td></tr>
  <tr><td>٥. إجمالي ضريبة المخرجات (على مبيعاتك)</td><td>—</td><td>${r.salesVat.toFixed(2)}</td></tr>
  <tr><td>٦. إجمالي ضريبة المدخلات القابلة للخصم (على مشترياتك)</td><td>—</td><td>${r.purchVat.toFixed(2)}</td></tr>
  <tr class="${refundable ? 'ref' : 'tot'}"><td>٧. ${refundable ? '💚 رصيد قابل للاسترداد / الترحيل' : 'صافي الضريبة المستحقة للهيئة'}</td><td>—</td><td>${Math.abs(r.netDue).toFixed(2)}</td></tr>
 </table>
 <div class="meta">
  ${refundable
        ? 'ضريبة مشترياتك أعلى من ضريبة مبيعاتك هذا الربع — عند تقديم الإقرار في بوابة الهيئة يمكنك طلب <b>استرداد</b> المبلغ أو <b>ترحيله</b> للربع التالي.'
        : 'هذا المبلغ يُسدَّد للهيئة عبر فاتورة سداد تصدر تلقائياً بعد تقديم الإقرار في بوابة فاتورة.'}
  <br>${settings.vat_enabled ? '' : '⚠️ الضريبة غير مفعّلة بعد (قبل التسجيل) — هذا التقرير تجريبي وستمتلئ أرقامه تلقائياً بعد التسجيل والتفعيل.'}
 </div>
 <div class="foot">أُنشئ آلياً من منصة تاكي — انسخ الأرقام إلى نموذج الإقرار في بوابة الهيئة (دقائق)، أو سلّمه لمحاسبك.</div>
</div>`;
        openPrintWindow(`إقرار ${quarter.label}`, html);
    };

    // ─── CSV ─────────────────────────────────────────────────────────────────
    const csvMonthly: CsvColumn<MonthRow>[] = [
        { header: 'الشهر', accessor: r => r.label },
        { header: 'عدد المدفوعات', accessor: r => r.count },
        { header: 'الإيراد الإجمالي (ر.س)', accessor: r => r.gross.toFixed(2) },
        { header: `الضريبة ${settings.vat_rate}% (ر.س)`, accessor: r => r.vat.toFixed(2) },
        { header: 'الصافي (ر.س)', accessor: r => r.net.toFixed(2) },
    ];
    const csvExpenses: CsvColumn<ExpenseRow>[] = [
        { header: 'التاريخ', accessor: r => r.invoice_date },
        { header: 'المورد', accessor: r => r.supplier_name },
        { header: 'الرقم الضريبي للمورد', accessor: r => r.supplier_vat_number || '' },
        { header: 'رقم الفاتورة', accessor: r => r.invoice_ref || '' },
        { header: 'التصنيف', accessor: r => catLabel(r.category) },
        { header: 'الإجمالي (ر.س)', accessor: r => Number(r.amount_gross).toFixed(2) },
        { header: 'الضريبة (ر.س)', accessor: r => Number(r.vat_amount).toFixed(2) },
    ];

    // ─── واجهة ───────────────────────────────────────────────────────────────
    const card = 'bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm';
    const inputCls = 'w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)] outline-none focus:border-teal-500';
    const lbl = 'text-[10px] font-bold text-[var(--text-secondary)] block mb-1';

    if (loading) {
        return <div className="space-y-3 animate-pulse">{[0, 1, 2].map(i => <div key={i} className="h-36 bg-[var(--gray-100)] rounded-2xl" />)}</div>;
    }

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header */}
            <section className={card} style={{ borderTop: '3px solid #0d9488' }}>
                <h2 className="font-extrabold text-lg text-[var(--text-primary)]">🧾 الزكاة والضريبة — نظام متكامل</h2>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1">
                    مبيعاتك تُحتسب تلقائياً من الاشتراكات، وأنت تضيف <b>فواتير مشترياتك</b> فقط — والنظام يجهّز
                    <b> الإقرار الضريبي بزر واحد</b> (ويحسب <b>الاسترداد</b> إذا كانت ضريبة مشترياتك أعلى)، ويطبع
                    <b> كل فواتير العملاء دفعة واحدة</b>. الربط الآلي API مع بوابة «فاتورة» يتطلب تسجيلاً ضريبياً سارياً —
                    كل بياناتك هنا مخزّنة بالصيغة الصحيحة بحيث يكون الربط لاحقاً تشغيلاً لا إعادة بناء.
                </p>
            </section>

            {/* متى أسجل؟ */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-2">📏 متى أسجل في هيئة الزكاة والضريبة والجمارك؟</h3>
                <div className="text-xs text-[var(--text-secondary)] leading-loose">
                    <b>الزكاة:</b> بمجرد إصدار السجل التجاري تُسجَّل منشأتك وتقدّم إقراراً زكوياً سنوياً (خلال ١٢٠ يوماً من نهاية السنة المالية).<br />
                    <b>ضريبة القيمة المضافة (١٥٪):</b> التسجيل <b>إلزامي</b> عند تجاوز {fmt(VAT_MANDATORY)} ر.س خلال ١٢ شهراً، و<b>اختياري</b> من {fmt(VAT_VOLUNTARY)} ر.س
                    (التسجيل الاختياري مفيد إذا كانت مشترياتك كبيرة — يتيح لك استرداد ضريبتها).
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
                        {meterState === 'mid' && '🟠 تجاوزت حد التسجيل الاختياري — يمكنك التسجيل الآن لاسترداد ضريبة مشترياتك، والإلزام عند ٣٧٥ ألف.'}
                        {meterState === 'under' && '🟢 أنت تحت حدود التسجيل — لا يلزمك تسجيل حالياً، والعدّاد يتابع تلقائياً.'}
                    </div>
                </div>
            </section>

            {/* ⚖️ الإقرار بزر واحد */}
            <section className={card} style={{ borderTop: '3px solid #6366f1' }}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-2">⚖️ الإقرار الضريبي والاسترداد — بزر واحد</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                    {quarters.map(q => (
                        <button key={q.key} onClick={() => setQKey(q.key)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-extrabold ${qKey === q.key ? 'bg-indigo-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            {q.label}
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="rounded-xl border border-[var(--border-color)] p-3">
                        <div className="text-[10px] font-bold text-[var(--text-secondary)]">ضريبة مبيعاتك (مخرجات)</div>
                        <div className="text-sm font-black text-[var(--text-primary)]">{fmt(vatReturn.salesVat)} ر.س</div>
                    </div>
                    <div className="rounded-xl border border-[var(--border-color)] p-3">
                        <div className="text-[10px] font-bold text-[var(--text-secondary)]">ضريبة مشترياتك (مدخلات)</div>
                        <div className="text-sm font-black text-[var(--text-primary)]">{fmt(vatReturn.purchVat)} ر.س</div>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: vatReturn.netDue < 0 ? '#ecfdf5' : 'var(--gray-100)', border: '1px solid var(--border-color)' }}>
                        <div className="text-[10px] font-bold" style={{ color: vatReturn.netDue < 0 ? '#047857' : 'var(--text-secondary)' }}>
                            {vatReturn.netDue < 0 ? '💚 رصيد استرداد' : 'صافي مستحق للهيئة'}
                        </div>
                        <div className="text-sm font-black" style={{ color: vatReturn.netDue < 0 ? '#047857' : 'var(--text-primary)' }}>{fmt(Math.abs(vatReturn.netDue))} ر.س</div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={printVatReturn}
                        className="flex-1 min-w-[180px] py-3 rounded-xl text-sm font-extrabold text-white active:scale-95"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#4338ca)' }}>
                        📄 توليد تقرير الإقرار كاملاً (طباعة / PDF)
                    </button>
                    <button onClick={printAllInvoices}
                        className="flex-1 min-w-[180px] py-3 rounded-xl text-sm font-extrabold text-white active:scale-95"
                        style={{ background: 'linear-gradient(135deg,#0d9488,#0f766e)' }}>
                        📚 كل فواتير العملاء للفترة (فاتورة لكل صفحة)
                    </button>
                </div>
                <p className="text-[10px] text-[var(--text-secondary)] font-bold mt-2 leading-relaxed">
                    💡 «الاسترداد» يعني: إذا كانت ضريبة مشترياتك أعلى من ضريبة مبيعاتك في الربع، الفرق يرجع لك من الهيئة (أو يُرحَّل للربع التالي) — لذلك سجِّل كل فاتورة مشتريات أدناه ولا تضيّع ريالاً.
                </p>
            </section>

            {/* 🛒 فواتير المشتريات (المدخلات) */}
            <section className={card} style={{ borderTop: '3px solid #f59e0b' }}>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-extrabold text-sm text-[var(--text-primary)]">🛒 فواتير مشترياتك (ضريبة المدخلات — للاسترداد)</h3>
                    <ExportButton rows={expenses} columns={csvExpenses} filenameStem="taki-expenses" label="CSV" tooltip="تنزيل سجل المشتريات كاملاً" />
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-3">
                    أضف هنا أي فاتورة تدفعها للمنصة (استضافة، إعلانات، أجهزة، محاسب…) — النظام يستخرج ضريبتها تلقائياً ويخصمها في الإقرار.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                    <label className="block"><span className={lbl}>تاريخ الفاتورة</span>
                        <input type="date" className={inputCls} value={exp.date} onChange={e => setExp({ ...exp, date: e.target.value })} /></label>
                    <label className="block"><span className={lbl}>المورد *</span>
                        <input className={inputCls} value={exp.supplier} onChange={e => setExp({ ...exp, supplier: e.target.value })} placeholder="مثال: شركة الاتصالات" /></label>
                    <label className="block"><span className={lbl}>الرقم الضريبي للمورد</span>
                        <input className={inputCls} value={exp.vatNo} onChange={e => setExp({ ...exp, vatNo: e.target.value })} placeholder="اختياري لكنه مهم للاسترداد" /></label>
                    <label className="block"><span className={lbl}>رقم الفاتورة</span>
                        <input className={inputCls} value={exp.ref} onChange={e => setExp({ ...exp, ref: e.target.value })} placeholder="اختياري" /></label>
                    <label className="block"><span className={lbl}>التصنيف</span>
                        <select className={inputCls} value={exp.cat} onChange={e => setExp({ ...exp, cat: e.target.value })}>
                            {EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select></label>
                    <label className="block"><span className={lbl}>الإجمالي شامل الضريبة (ر.س) *</span>
                        <input type="number" inputMode="decimal" step="0.01" className={inputCls} value={exp.gross}
                            onChange={e => setExp({ ...exp, gross: e.target.value, vat: suggestedVat(e.target.value) })} placeholder="115.00" /></label>
                    <label className="block"><span className={lbl}>الضريبة (تُحسب تلقائياً)</span>
                        <input type="number" inputMode="decimal" step="0.01" className={inputCls} value={exp.vat}
                            onChange={e => setExp({ ...exp, vat: e.target.value })} placeholder="15.00" /></label>
                    <label className="block"><span className={lbl}>الوصف</span>
                        <input className={inputCls} value={exp.desc} onChange={e => setExp({ ...exp, desc: e.target.value })} placeholder="اختياري" /></label>
                </div>
                <button onClick={addExpense} disabled={addingExp}
                    className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white disabled:opacity-40 active:scale-95"
                    style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}>
                    {addingExp ? 'جاري الإضافة…' : '➕ إضافة فاتورة المشتريات'}
                </button>
                {expenses.length > 0 && (
                    <div className="mt-3 space-y-2">
                        {expenses.slice(0, 30).map(e => (
                            <div key={e.id} className="flex items-center gap-2 border border-[var(--border-color)] rounded-xl px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-extrabold text-[var(--text-primary)] truncate">{e.supplier_name} <span className="font-bold text-[var(--text-secondary)]">— {catLabel(e.category)}</span></div>
                                    <div className="text-[10px] text-[var(--text-secondary)] font-bold">
                                        {e.invoice_date} • الإجمالي {fmt(Number(e.amount_gross))} ر.س • الضريبة <span className="text-amber-600">{fmt(Number(e.vat_amount))} ر.س</span>
                                        {e.invoice_ref ? ` • #${e.invoice_ref}` : ''}
                                    </div>
                                </div>
                                <button onClick={() => removeExpense(e.id)} className="w-8 h-8 rounded-lg bg-red-50 text-red-600 text-sm flex items-center justify-center active:scale-90" aria-label="حذف">🗑</button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* الإعدادات */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-3">⚙️ إعدادات الفواتير والضريبة</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block"><span className={lbl}>اسم المنشأة (يظهر على الفاتورة)</span>
                        <input className={inputCls} value={settings.entity_name} onChange={e => upd({ entity_name: e.target.value })} /></label>
                    <label className="block"><span className={lbl}>السجل التجاري / وثيقة العمل الحر</span>
                        <input className={inputCls} value={settings.cr_number} onChange={e => upd({ cr_number: e.target.value })} placeholder="اختياري" /></label>
                    <label className="block"><span className={lbl}>الرقم الضريبي (بعد التسجيل)</span>
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
                    <ExportButton rows={monthly} columns={csvMonthly} filenameStem="taki-tax-monthly" label="تصدير CSV" tooltip="تنزيل الجدول الشهري كملف CSV جاهز للمحاسب" />
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
                    <div className="text-[11px] text-[var(--text-secondary)] font-bold mt-2">لا توجد مدفوعات مسجلة بعد — الجدول يمتلئ تلقائياً فور تفعيل بوابة الدفع الحقيقية.</div>
                )}
            </section>

            {/* الزكاة */}
            <section className={card} style={{ borderTop: '3px solid #f59e0b' }}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-2">🕌 الزكاة — حاسبة الوعاء الزكوي</h3>
                <div className="grid grid-cols-3 gap-2 mb-2">
                    <label className="block"><span className={lbl}>رأس المال (ر.س)</span>
                        <input type="number" inputMode="decimal" className={inputCls} value={settings.zakat_capital || ''} onChange={e => upd({ zakat_capital: parseFloat(e.target.value) || 0 })} placeholder="0" /></label>
                    <label className="block"><span className={lbl}>صافي الربح السنوي (ر.س)</span>
                        <input type="number" inputMode="decimal" className={inputCls} value={settings.zakat_profit || ''} onChange={e => upd({ zakat_profit: parseFloat(e.target.value) || 0 })} placeholder="0" /></label>
                    <label className="block"><span className={lbl}>الأصول الثابتة (تُخصم)</span>
                        <input type="number" inputMode="decimal" className={inputCls} value={settings.zakat_fixed_assets || ''} onChange={e => upd({ zakat_fixed_assets: parseFloat(e.target.value) || 0 })} placeholder="0" /></label>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                    <div><span className="text-[10px] font-bold text-[var(--text-secondary)]">الوعاء الزكوي: </span><b className="text-[var(--text-primary)]">{fmt(zakatBase)} ر.س</b></div>
                    <div className="text-2xl font-black" style={{ color: '#b45309' }}>الزكاة: {fmt(zakatDue)} ر.س</div>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-1">
                    الوعاء = رأس المال + صافي الربح − الأصول الثابتة، والزكاة {settings.zakat_rate}٪ (سنة هجرية).
                    وللمقارنة السريعة: {settings.zakat_rate}٪ من صافي إيرادات آخر ١٢ شهراً = <b>{fmt(zakatQuick)} ر.س</b>.
                    الوعاء النظامي الدقيق يعتمده محاسبك من قائمة المركز المالي في الإقرار السنوي.
                </p>
            </section>

            {/* الفواتير */}
            <section className={card}>
                <h3 className="font-extrabold text-sm text-[var(--text-primary)] mb-3">📄 فواتير العملاء (أحدث ٥٠ دفعة)</h3>
                {payments.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-secondary)] font-bold">لا توجد مدفوعات بعد — كل دفعة اشتراك ستظهر هنا بفاتورة جاهزة، وزر «كل الفواتير» أعلاه يطبعها دفعة واحدة.</div>
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
