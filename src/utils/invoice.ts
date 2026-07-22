/**
 * invoice.ts — مولّد الفواتير المشترك (v12.17)
 *
 * يستخدمه تبويب الأدمن «الزكاة والضريبة» (فاتورة مفردة + طباعة جماعية) وصفحة
 * الاشتراك لدى التاجر («🧾 فواتيري»). قبل التسجيل الضريبي تصدر «فاتورة» عادية
 * بلا ضريبة (النظامي)، وبعد تفعيل الضريبة + الرقم الضريبي تتحول تلقائياً إلى
 * «فاتورة ضريبية مبسطة» ببيانات QR بصيغة ZATCA TLV.
 *
 * الطباعة عبر نافذة جديدة بلا سكربتات خارجية (CSP-safe — inline styles مسموحة).
 */

export interface InvoiceTaxSettings {
    entity_name: string;
    cr_number?: string;
    vat_number?: string;
    vat_enabled?: boolean;
    prices_include_vat?: boolean;
    vat_rate?: number;
}

export interface InvoicePayment {
    id: string;
    amount: number;
    status?: string | null;
    paid_at?: string | null;
    created_at: string;
    branches_count?: number | null;
    period_start?: string | null;
    period_end?: string | null;
}

export const invoiceIsPaid = (p: InvoicePayment): boolean =>
    !!p.paid_at || ['paid', 'succeeded', 'success', 'completed'].includes(String(p.status || '').toLowerCase());

// ZATCA TLV (المرحلة الأولى من الفوترة الإلكترونية): Tag1 اسم البائع، Tag2 الرقم
// الضريبي، Tag3 التاريخ ISO، Tag4 الإجمالي شامل الضريبة، Tag5 الضريبة — ثم base64.
export function zatcaTlvBase64(seller: string, vat: string, iso: string, total: string, vatAmt: string): string {
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

/** فاتورة واحدة كـHTML (pageBreak=true عند الطباعة الجماعية — فاتورة لكل صفحة). */
export function buildInvoiceHtml(p: InvoicePayment, s: InvoiceTaxSettings, merchantName: string, pageBreak = false): string {
    const rate = s.vat_rate ?? 15;
    const includeVat = s.prices_include_vat !== false;
    const gross = Number(p.amount) || 0;
    const vat = s.vat_enabled ? (includeVat ? (gross * rate) / (100 + rate) : (gross * rate) / 100) : 0;
    const net = includeVat ? gross - vat : gross;
    const total = includeVat ? gross : gross + vat;
    const dt = new Date(p.paid_at || p.created_at);
    const isTax = !!s.vat_enabled && !!s.vat_number;
    const tlv = isTax ? zatcaTlvBase64(s.entity_name, s.vat_number || '', dt.toISOString(), total.toFixed(2), vat.toFixed(2)) : '';
    // 'ar-SA' وحدها تطبع التاريخ هجرياً (أم القرى) — إجبار الميلادي على الفاتورة
    const period = p.period_start && p.period_end
        ? `${new Date(p.period_start).toLocaleDateString('ar-SA-u-ca-gregory')} ← ${new Date(p.period_end).toLocaleDateString('ar-SA-u-ca-gregory')}` : '—';
    return `<div class="inv${pageBreak ? ' pb' : ''}">
 <h1>🧾 ${isTax ? 'فاتورة ضريبية مبسطة' : 'فاتورة'} <span class="badge">${invoiceIsPaid(p) ? 'مدفوعة' : String(p.status || '')}</span></h1>
 <div class="sub">${s.entity_name}${s.cr_number ? ' — سجل/وثيقة: ' + s.cr_number : ''}${isTax ? ' — الرقم الضريبي: ' + s.vat_number : ''}</div>
 <div class="meta">رقم الفاتورة: <b>INV-${p.id}</b><br>التاريخ: <b>${dt.toLocaleDateString('ar-SA-u-ca-gregory')} ${dt.toLocaleTimeString('ar-SA')}</b><br>
  العميل (التاجر): <b>${merchantName}</b><br>البيان: اشتراك باقة مواقع${p.branches_count ? ` (${p.branches_count} مواقع)` : ''} — الفترة: ${period}</div>
 <table><tr><th>البند</th><th>المبلغ (ر.س)</th></tr>
  <tr><td>قيمة الاشتراك${includeVat && isTax ? ' (قبل الضريبة)' : ''}</td><td>${net.toFixed(2)}</td></tr>
  ${isTax ? `<tr><td>ضريبة القيمة المضافة ${rate}٪</td><td>${vat.toFixed(2)}</td></tr>` : ''}
  <tr class="tot"><td>الإجمالي${isTax ? ' شامل الضريبة' : ''}</td><td>${total.toFixed(2)}</td></tr></table>
 ${isTax ? `<div class="qr"><b>ZATCA QR (TLV Base64):</b><br>${tlv}</div>` : '<div class="qr">منشأة غير مسجلة في ضريبة القيمة المضافة بعد — لا تُحصَّل ضريبة على هذه الفاتورة.</div>'}
 <div class="foot">فاتورة صادرة إلكترونياً من منصة تاكي</div></div>`;
}

/** نافذة طباعة/حفظ PDF. ترجع false إذا حجب المتصفح النوافذ المنبثقة. */
export function openPrintWindow(title: string, bodyHtml: string): boolean {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head><body>
${bodyHtml}
<div class="noprint" style="text-align:center;margin:14px"><button onclick="window.print()" style="padding:10px 26px;border-radius:10px;border:0;background:#0d9488;color:#fff;font-weight:800;font-size:14px">🖨 طباعة / حفظ PDF</button></div>
</body></html>`);
    w.document.close();
    return true;
}
