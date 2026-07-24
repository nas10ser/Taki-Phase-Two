// v12.87/88 — فاتورة طلب قابلة للطباعة مع باركود الكاشير (طلب ناصر).
//
// تبني مستنداً HTML مستقلاً تماماً (بلا أي اعتماد خارجي) وتفتحه في تبويب
// جديد ثم تطبعه. لكل عنصر يحمل رمز كاشير (SKU) يُطبع باركود Code 128 قابل
// للمسح — يمرّر الكاشير القارئ فيُضاف العنصر تلقائياً لسلّة نظامه (مطابقة SKU).
//
// على الآيفون قد يمنع المتصفح النافذة المنبثقة داخل التطبيق المثبّت — لذلك
// نوفّر بديلاً: كتابة الفاتورة في iframe مخفي وطباعته.
//
// ملاحظة نظامية: هذه فاتورة/سند طلب من «تاكي» لتسهيل التشغيل، وليست الفاتورة
// الضريبية (زاتكا) — تلك يصدرها التاجر من نظامه لأن الدفع يتم على حسابه.

import { code128SVG } from './barcode128';

export interface InvoiceLineItem {
    label: string;
    qty?: number;
    /** رمز الكاشير — يُطبع باركوداً إن وُجد، وإلا يُطبع الاسم نصاً فقط */
    sku?: string;
    kind: 'main' | 'variant' | 'addon';
}

export interface InvoiceData {
    shopName: string;
    itemName: string;
    barcode: string;
    createdAt?: number;
    quantity: number | string;
    buyerName?: string;
    prepTime?: string | number;
    /** عناصر مهيكلة (لكل عنصر باركود إن كان له SKU) */
    items?: InvoiceLineItem[];
    /** سطر الإجمالي (نص جاهز مثل «26 ر.س») */
    totalText?: string;
    /** ملاحظة المشتري الحرّة */
    buyerNote?: string;
    /** v12.93 — حالة الدفع: true = مدفوع إلكترونياً (وصل حساب التاجر)، false/undefined = عند الاستلام */
    paidOnline?: boolean;
    paidAmount?: number;
    isRTL: boolean;
}

const esc = (s: string): string =>
    String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));

const buildHtml = (d: InvoiceData): string => {
    const rtl = d.isRTL;
    const dir = rtl ? 'rtl' : 'ltr';
    const L = (ar: string, en: string) => (rtl ? ar : en);
    const dateStr = d.createdAt
        ? new Date(d.createdAt).toLocaleString(rtl ? 'ar-SA-u-ca-gregory' : 'en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        : '';
    const prep = d.prepTime === 'arrival'
        ? (rtl ? 'عند الوصول' : 'On arrival')
        : (d.prepTime ? `${d.prepTime} ${rtl ? 'دقيقة' : 'min'}` : '');

    const items = (d.items || []).filter(it => it.label);
    const itemHtml = items.map((it) => {
        const qtyPrefix = it.qty && it.qty > 1 ? `${it.qty}× ` : '';
        const nameLine = `<div class="li-name">${it.kind === 'addon' ? '↳ ' : ''}${esc(qtyPrefix + it.label)}</div>`;
        const sku = (it.sku || '').trim();
        if (!sku) {
            // بلا SKU: اسم نصّي فقط (يُدخله الكاشير يدوياً) — الخطة البديلة.
            return `<div class="li ${it.kind}">${nameLine}</div>`;
        }
        const svg = code128SVG(sku, { height: 42, moduleWidth: 2 });
        const barcode = svg
            ? `<div class="barcode">${svg}</div><div class="li-sku">SKU: ${esc(sku)}</div>`
            : `<div class="li-sku">SKU: ${esc(sku)}</div>`;
        return `<div class="li ${it.kind}">${nameLine}${barcode}</div>`;
    }).join('');

    return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L('فاتورة طلب', 'Order Invoice')} — ${esc(d.barcode)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 18px; color: #0f172a; background: #fff; }
  .invoice { max-width: 384px; margin: 0 auto; }
  .head { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 10px; }
  .shop { font-size: 22px; font-weight: 900; }
  .sub { font-size: 12px; color: #64748b; margin-top: 3px; }
  .row { display: flex; justify-content: space-between; font-size: 13px; margin: 3px 0; }
  .row .k { color: #64748b; font-weight: 700; }
  .row .v { font-weight: 800; }
  .items { border-top: 1px dashed #cbd5e1; margin-top: 10px; padding-top: 6px; }
  .li { padding: 10px 0; border-bottom: 1px dashed #e2e8f0; text-align: center; }
  .li.addon { padding: 6px 0; }
  .li-name { font-size: 15px; font-weight: 900; text-align: ${rtl ? 'right' : 'left'}; }
  .li.addon .li-name { font-size: 13px; font-weight: 700; color: #475569; padding-inline-start: 12px; }
  .barcode { margin: 6px 0 2px; text-align: center; }
  .barcode svg { max-width: 100%; height: auto; }
  .li-sku { font-size: 11px; color: #334155; font-weight: 800; letter-spacing: 1px; font-family: "Courier New", monospace; }
  .total { display: flex; justify-content: space-between; font-size: 17px; font-weight: 900; margin-top: 12px; padding-top: 8px; border-top: 2px solid #0f172a; }
  .pay { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 15px; font-weight: 900; text-align: center; border: 2px solid; }
  .pay .pay-sub { display: block; font-size: 11px; font-weight: 700; margin-top: 3px; }
  .pay.paid { background: #dcfce7; color: #166534; border-color: #16a34a; }
  .pay.cod { background: #fef3c7; color: #92400e; border-color: #d97706; }
  .stamp { margin-top: 24px; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
  .stamp .box { border-top: 1px solid #94a3b8; width: 45%; padding-top: 4px; text-align: center; }
  .note { margin-top: 10px; font-size: 12px; background: #f1f5f9; border-radius: 8px; padding: 8px 10px; }
  .foot { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 16px; line-height: 1.6; }
  .btns { text-align: center; margin: 16px 0; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .btns button { font-size: 15px; font-weight: 800; padding: 12px 22px; border-radius: 12px; border: none; background: #10b981; color: #fff; cursor: pointer; }
  .btns button.back { background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; }
  @media print { .btns { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="invoice">
    <div class="head">
      <div class="shop">${esc(d.shopName)}</div>
      <div class="sub">${L('فاتورة / سند طلب', 'Order receipt')}</div>
    </div>
    <div class="row"><span class="k">${L('رقم الطلب', 'Order #')}</span><span class="v">${esc(d.barcode)}</span></div>
    ${dateStr ? `<div class="row"><span class="k">${L('التاريخ', 'Date')}</span><span class="v">${esc(dateStr)}</span></div>` : ''}
    ${d.buyerName ? `<div class="row"><span class="k">${L('المشتري', 'Buyer')}</span><span class="v">${esc(d.buyerName)}</span></div>` : ''}
    <div class="row"><span class="k">${L('الكمية', 'Qty')}</span><span class="v">${esc(String(d.quantity))}</span></div>
    ${prep ? `<div class="row"><span class="k">${L('وقت التجهيز', 'Prep')}</span><span class="v">${esc(prep)}</span></div>` : ''}
    <div class="items">
      ${itemHtml || `<div class="li"><div class="li-name">${esc(d.itemName)}</div></div>`}
    </div>
    ${d.totalText ? `<div class="total"><span>${L('الإجمالي', 'Total')}</span><span>${esc(d.totalText)}</span></div>` : ''}
    <div class="pay ${d.paidOnline ? 'paid' : 'cod'}">
      ${d.paidOnline
        ? `${L('✅ مدفوع إلكترونياً', '✅ Paid online')}<span class="pay-sub">${L('وصل حساب التاجر — لا تطلب مبلغاً من العميل', 'Sent to merchant — do not collect cash')}${d.paidAmount != null ? ` (${esc(String(d.paidAmount))} ${L('ر.س','SAR')})` : ''}</span>`
        : `${L('💵 الدفع عند الاستلام', '💵 Pay at pickup')}<span class="pay-sub">${L('استلم المبلغ نقداً/شبكة من العميل', 'Collect payment from the buyer')}</span>`}
    </div>
    ${d.buyerNote ? `<div class="note">📝 ${L('ملاحظة المشتري', 'Buyer note')}: ${esc(d.buyerNote)}</div>` : ''}
    <div class="stamp">
      <div class="box">${L('توقيع/ختم التاجر', 'Merchant stamp')}</div>
      <div class="box">${L('استلمت الطلب', 'Received')}</div>
    </div>
    <div class="foot">${L('صادرة عبر منصة تاكي — سند تشغيلي وليس فاتورة ضريبية. الفاتورة الضريبية (زاتكا) تصدر من نظام التاجر.', 'Issued via TAKI — operational receipt, not a tax invoice.')}</div>
  </div>
  <div class="btns">
    <button onclick="window.print()">${L('🖨 اطبع الآن', '🖨 Print now')}</button>
    <button class="back" onclick="(function(){ try{ window.close(); }catch(e){} setTimeout(function(){ try{ history.back(); }catch(e2){} }, 60); })()">${L('← عودة للتطبيق', '← Back to app')}</button>
  </div>
  <script>window.addEventListener('load', function(){ setTimeout(function(){ try { window.print(); } catch(e){} }, 400); });</script>
</body>
</html>`;
};

export const printOrderInvoice = (data: InvoiceData): void => {
    const html = buildHtml(data);
    // المحاولة الأولى: تبويب جديد (الأكثر توافقاً على الديسكتوب وأندرويد ويعطي
    // آيفون صفحة يشاركها/يحفظها PDF من زر المشاركة).
    const w = window.open('', '_blank');
    if (w && w.document) {
        w.document.open();
        w.document.write(html);
        w.document.close();
        return;
    }
    // البديل (نافذة ممنوعة داخل PWA): iframe مخفي نطبع محتواه.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
        setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 1500);
    }, 500);
};
