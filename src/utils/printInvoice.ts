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

// v13.11 — بناء بيانات الفاتورة من صفّ حجز واحد (طلب ناصر: يستخدمها التاجر
// (لوحته) والمشتري (حجوزاتي) معاً بلا تكرار). تبني العناصر المهيكلة من النوع/
// الإضافات المختارة، وتقرأ الإجمالي وملاحظة المشتري من نص الملاحظات، وحالة
// الدفع من paidAt (مدفوع إلكترونياً) وإلا الدفع عند الاستلام.
export const buildBookingInvoice = (order: any, isRTL: boolean): InvoiceData => {
    const deal = (order?.deal || {}) as any;
    const sel = ((order?.selectedOptions || []) as Array<{ g: string; c: string; qty?: number }>);
    const dvariants = (deal.variants || []) as any[];
    const doptions = (deal.options || []) as any[];
    const items: InvoiceLineItem[] = [];
    const pickedVariants = sel.filter(s => s.g === '__variant__');
    if (pickedVariants.length) {
        for (const s of pickedVariants) {
            const v = dvariants.find(vv => vv.id === s.c);
            if (v) items.push({ label: v.label, qty: s.qty || 1, sku: v.posSku, kind: 'variant' });
        }
    } else {
        items.push({ label: deal.itemName, qty: Number(order?.bookedQuantity) || 1, sku: deal.posSku, kind: 'main' });
    }
    for (const s of sel) {
        if (s.g === '__variant__') continue;
        const grp = doptions.find(g => g.id === s.g);
        const choice = grp?.choices?.find((c: any) => c.id === s.c);
        if (!choice) continue;
        items.push({ label: grp ? `${grp.title}: ${choice.label}` : choice.label, qty: s.qty || 1, sku: choice.posSku, kind: 'addon' });
    }
    const notes: string = order?.notes || '';
    const tm = notes.match(/الإجمالي:\s*([\d.]+)/);
    const totalText = tm ? `${tm[1]} ${isRTL ? 'ر.س' : 'SAR'}` : undefined;
    const bn = notes.match(/📝\s*([\s\S]*?)(?:\n💰|$)/);
    const buyerNote = bn && bn[1].trim() ? bn[1].trim() : undefined;
    return {
        shopName: deal.shopName || deal.itemName,
        itemName: deal.itemName,
        barcode: order?.barcode,
        createdAt: order?.bookedAt,
        quantity: order?.bookedQuantity,
        buyerName: order?.userName,
        prepTime: order?.prepTime,
        items,
        totalText,
        buyerNote,
        // v12.93 — حالة الدفع: مدفوع إلكترونياً (paidAt) وإلا الدفع عند الاستلام
        paidOnline: !!order?.paidAt,
        paidAmount: order?.paidAmount,
        isRTL,
    };
};

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

    // v13.10 — باركود رقم الطلب دائماً (حتى بلا رمز كاشير للأصناف) — طلب ناصر:
    // فيمسحه التاجر/الكاشير فيفتح الطلب مباشرةً. رقم الطلب أبجدي-رقمي فيدعمه Code128.
    const orderSvg = code128SVG(d.barcode, { height: 54, moduleWidth: 2 });
    const orderBarcodeHtml = orderSvg
        ? `<div class="ordercode"><div class="barcode">${orderSvg}</div><div class="li-sku">${L('رقم الطلب', 'Order #')}: ${esc(d.barcode)}</div></div>`
        : '';

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
  .ordercode { text-align: center; padding: 8px 0 12px; border-bottom: 2px dashed #cbd5e1; margin-bottom: 8px; }
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
    ${orderBarcodeHtml}
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
</body>
</html>`;
};

// v13.08 — نعرض الفاتورة كطبقة داخل التطبيق (لا تبويب جديد). على آيفون PWA كان
// التبويب الجديد يجعل «اطبع الآن» (window.print) و«عودة للتطبيق» (window.close/
// history.back) لا تعمل — بلاغ ناصر. الآن الفاتورة داخل iframe مستقل (عزل الطباعة)
// فوق التطبيق، والأزرار يتحكّم بها التطبيق: «اطبع» يطبع الـiframe فقط، و«عودة»
// تُزيل الطبقة وتُبقيك في مكانك بالتطبيق. زر أندرويد الخلفي يُغلقها أيضاً.
export const printOrderInvoice = (data: InvoiceData): void => {
    const html = buildHtml(data);
    const rtl = data.isRTL;
    const L = (ar: string, en: string) => (rtl ? ar : en);

    const overlay = document.createElement('div');
    overlay.dir = rtl ? 'rtl' : 'ltr';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#f8fafc;display:flex;flex-direction:column;';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;justify-content:center;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;background:#0f172a;flex-shrink:0;';
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.textContent = L('🖨 اطبع الآن', '🖨 Print now');
    printBtn.style.cssText = 'font-size:15px;font-weight:800;padding:12px 22px;border-radius:12px;border:none;background:#10b981;color:#fff;cursor:pointer;';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = L('← عودة للتطبيق', '← Back to app');
    backBtn.style.cssText = 'font-size:15px;font-weight:800;padding:12px 22px;border-radius:12px;border:1px solid #cbd5e1;background:#f1f5f9;color:#0f172a;cursor:pointer;';
    bar.appendChild(printBtn);
    bar.appendChild(backBtn);

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';
    iframe.setAttribute('title', L('فاتورة الطلب', 'Order invoice'));

    overlay.appendChild(bar);
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    // امنع تمرير التطبيق خلف الطبقة
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const doc = iframe.contentWindow?.document;
    if (doc) { doc.open(); doc.write(html); doc.close(); }

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevBodyOverflow;
        try { document.body.removeChild(overlay); } catch { /* ignore */ }
    };
    // Esc يُغلق أيضاً (ديسكتوب). لا نلمس سجل المتصفح حتى لا نتضارب مع الراوتر.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    backBtn.onclick = close;
    printBtn.onclick = () => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
    };
};
