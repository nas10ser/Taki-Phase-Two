// v12.87 — فاتورة طلب قابلة للطباعة (طلب ناصر «خيار طباعتها بفاتورة»).
//
// تبني مستنداً HTML مستقلاً تماماً (بلا أي اعتماد خارجي) وتفتحه في تبويب
// جديد ثم تطبعه. على الآيفون قد يمنع المتصفح النافذة المنبثقة داخل التطبيق
// المثبّت — لذلك نوفّر بديلاً: كتابة الفاتورة في iframe مخفي وطباعته. وإن
// تعذّر الاثنان يبقى «مشاركة/حفظ PDF» من زر المشاركة متاحاً للتاجر.
//
// ملاحظة نظامية: هذه فاتورة/سند طلب من «تاكي» لتسهيل التشغيل، وليست الفاتورة
// الضريبية (زاتكا) — تلك يصدرها التاجر من نظامه لأن الدفع يتم على حسابه.

export interface InvoiceData {
    shopName: string;
    itemName: string;
    barcode: string;
    createdAt?: number;
    quantity: number | string;
    buyerName?: string;
    prepTime?: string | number;
    /** نص «تفاصيل الطلب» المجمّع (الأنواع + الاختيارات + الإجمالي) كما يُخزَّن في الحجز */
    details?: string;
    isRTL: boolean;
}

const esc = (s: string): string =>
    String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));

const buildHtml = (d: InvoiceData): string => {
    const rtl = d.isRTL;
    const dir = rtl ? 'rtl' : 'ltr';
    const dateStr = d.createdAt
        ? new Date(d.createdAt).toLocaleString(rtl ? 'ar-SA-u-ca-gregory' : 'en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        : '';
    const prep = d.prepTime === 'arrival'
        ? (rtl ? 'عند الوصول' : 'On arrival')
        : (d.prepTime ? `${d.prepTime} ${rtl ? 'دقيقة' : 'min'}` : '');
    // نحوّل نص التفاصيل المجمّع إلى أسطر HTML آمنة، مع إبراز أسطر الأنواع والإجمالي.
    const detailHtml = (d.details || '')
        .split('\n')
        .map((line) => {
            const t = line.trim();
            if (!t) return '';
            const strong = t.startsWith('•') || t.startsWith('📦') || t.startsWith('💰') || t.startsWith('▪️');
            const indented = t.startsWith('↳') || t.startsWith('(');
            return `<div class="line${strong ? ' strong' : ''}${indented ? ' indent' : ''}">${esc(line)}</div>`;
        })
        .join('');

    const L = (ar: string, en: string) => (rtl ? ar : en);

    return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L('فاتورة طلب', 'Order Invoice')} — ${esc(d.barcode)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 20px; color: #0f172a; background: #fff; }
  .invoice { max-width: 380px; margin: 0 auto; }
  .head { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 12px; }
  .shop { font-size: 22px; font-weight: 900; }
  .sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  .row { display: flex; justify-content: space-between; font-size: 13px; margin: 4px 0; }
  .row .k { color: #64748b; font-weight: 700; }
  .row .v { font-weight: 800; }
  .item { font-size: 16px; font-weight: 900; margin: 12px 0 8px; }
  .details { border-top: 1px dashed #cbd5e1; border-bottom: 1px dashed #cbd5e1; padding: 10px 0; margin: 10px 0; }
  .line { font-size: 14px; line-height: 1.9; white-space: pre-wrap; }
  .line.strong { font-weight: 900; }
  .line.indent { color: #475569; padding-inline-start: 14px; font-size: 13px; }
  .stamp { margin-top: 26px; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
  .stamp .box { border-top: 1px solid #94a3b8; width: 45%; padding-top: 4px; text-align: center; }
  .foot { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 18px; line-height: 1.6; }
  .btns { text-align: center; margin: 16px 0; }
  .btns button { font-size: 15px; font-weight: 800; padding: 12px 26px; border-radius: 12px; border: none; background: #10b981; color: #fff; cursor: pointer; }
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
    <div class="item">${esc(d.itemName)}</div>
    ${detailHtml ? `<div class="details">${detailHtml}</div>` : ''}
    <div class="stamp">
      <div class="box">${L('توقيع/ختم التاجر', 'Merchant stamp')}</div>
      <div class="box">${L('استلمت الطلب', 'Received')}</div>
    </div>
    <div class="foot">${L('صادرة عبر منصة تاكي — سند تشغيلي وليس فاتورة ضريبية. الفاتورة الضريبية (زاتكا) تصدر من نظام التاجر.', 'Issued via TAKI — operational receipt, not a tax invoice.')}</div>
  </div>
  <div class="btns"><button onclick="window.print()">${L('🖨 اطبع الآن', '🖨 Print now')}</button></div>
  <script>window.addEventListener('load', function(){ setTimeout(function(){ try { window.print(); } catch(e){} }, 350); });</script>
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
