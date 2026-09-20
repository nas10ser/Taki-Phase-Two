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
import { KSA_VAT_RATE, fmtSAR } from './vat';
import { qrFromTlv, isValidSaudiVat } from './zatcaQr';
import { supabase } from '../services/supabaseClient';

export interface InvoiceLineItem {
    label: string;
    qty?: number;
    /** رمز الكاشير — يُطبع باركوداً إن وُجد، وإلا يُطبع الاسم نصاً فقط */
    sku?: string;
    kind: 'main' | 'variant' | 'addon';
}

/** v14.06 — لقطة عنوان التوصيل المحفوظة على الحجز (يكتبها حارس القاعدة). */
export interface InvoiceDeliveryAddress {
    label?: string;
    details?: string;
    city?: string;
    phone?: string;
    lat?: number | string;
    lng?: number | string;
}

export interface InvoiceData {
    shopName: string;
    itemName: string;
    barcode: string;
    /** v14.06 — الكود الاحتياطي (يُدخله التاجر يدوياً إن تعذّر المسح) */
    backupCode?: string;
    createdAt?: number;
    quantity: number | string;
    buyerName?: string;
    /** v14.06 — جوال المشتري (يظهر لصاحب الحجز وتاجره — كلاهما يعرفه أصلاً) */
    buyerPhone?: string;
    /** v14.06 — سعر القطعة (سطر نظامي معتاد على الفواتير) */
    unitPrice?: number;
    /** v14.06 — اسم الفرع المختار في العرض متعدد المواقع */
    branchName?: string;
    /** v14.06 — طريقة الاستلام: استلام من المتجر أو توصيل إلى عنوان المشتري */
    fulfillment?: 'pickup' | 'delivery';
    deliveryFee?: number;
    deliveryAddress?: InvoiceDeliveryAddress | null;
    prepTime?: string | number;
    /** عناصر مهيكلة (لكل عنصر باركود إن كان له SKU) */
    items?: InvoiceLineItem[];
    /** سطر الإجمالي (نص جاهز مثل «26 ر.س») */
    totalText?: string;
    /** v13.30 — الإجمالي رقماً (شامل الضريبة) لطباعة تفصيل ضريبة القيمة المضافة */
    totalAmount?: number;
    /** ملاحظة المشتري الحرّة */
    buyerNote?: string;
    /** v14.06 — ملاحظة التاجر للمشتري (كانت تُطبع في البوت ولا تظهر على الورقة) */
    merchantNote?: string;
    /** v12.93 — حالة الدفع: true = مدفوع إلكترونياً (وصل حساب التاجر)، false/undefined = عند الاستلام */
    paidOnline?: boolean;
    paidAmount?: number;
    /** v14.06 — نيّة الدفع وقت الحجز: 'online' غير مسدَّد ⇒ لا يُقال للتاجر «استلم نقداً». */
    paymentMethod?: 'cod' | 'online';
    /** v14.06 — الإجمالي مُقدَّر من سعر العرض (لا من طلب الموقع ولا من دفعة فعلية). */
    totalIsEstimate?: boolean;
    /** v13.13 — حالة الطلب على الفاتورة: 'completed' (مكتمل) | 'cancelled' (ملغي)
     *  | غيرها/undefined (نشط). للطلبات المنتهية يُطبع بانر واضح. */
    status?: string;
    /** v13.13 — من ألغى الطلب (للملغية): 'buyer'|'seller'|'system'|'expired'… */
    cancelledBy?: string;
    /** v13.35 — لجلب الرقم الضريبي للتاجر (توافق الهيئة): مسجّل ← فاتورة مبسطة بQR */
    storeId?: string;
    sellerVatNumber?: string | null;
    /** v14.17 — لقطة الفاتورة كما جُمِّدت لحظة البيع (جدول order_invoices).
     *  لا تُحسب هنا ولا تُقرأ من إعدادات حيّة: الرقم الذي طُبع أوّل مرّة هو
     *  الرقم الذي يُطبع دائماً، مهما عدّل التاجر بياناته بعدها. */
    invoiceNo?: string | null;
    issuedAt?: string | null;
    vatRate?: number | null;
    vatBase?: number | null;
    vatAmount?: number | null;
    /** v14.68 — رمز زاتكا **مُرمَّزاً في القاعدة** (لا يُحسب هنا). */
    zatcaTlv?: string | null;
    sellerAddress?: string | null;
    /** v14.18 — إشعار دائن: طلبٌ رُدّ مبلغه. يُطبع على نفس الورقة فلا تبقى
     *  فاتورةٌ تقول «مدفوع» عن مالٍ عاد لصاحبه. */
    creditNoteNo?: string | null;
    refundAmount?: number | null;
    refundRef?: string | null;
    refundedAt?: string | null;
    /** يُملأ داخلياً قبل الطباعة — صورة QR للفوترة الإلكترونية */
    qrDataUrl?: string;
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
    // v14.11 — الرقم من العمود الذي كتبه الخادم لحظة الحجز (بضاعة + إضافات +
    // توصيل)، وهو نفسه ما يطالب به الدفع الإلكتروني. سطر الملاحظات بقي
    // للحجوزات التي سبقت العمود وحدها، ثم مبلغُ دفعةٍ فعلية كملاذ أخير.
    const serverTotal = Number(order?.totalAmount) > 0 ? Number(order.totalAmount) : undefined;
    const totalAmount = serverTotal
        ?? (tm ? parseFloat(tm[1]) : (Number(order?.paidAmount) > 0 ? Number(order?.paidAmount) : undefined));
    const totalText = totalAmount != null ? `${totalAmount} ${isRTL ? 'ر.س' : 'SAR'}` : undefined;
    const bn = notes.match(/📝\s*([\s\S]*?)(?:\n💰|$)/);
    const buyerNote = bn && bn[1].trim() ? bn[1].trim() : undefined;
    // v14.06 — التوصيل: الرسوم تدخل الإجمالي (كما يدفعها المشتري فعلاً). سطر
    // «الإجمالي» في الملاحظات يكتبه الموقع شاملاً الرسوم، فلا تُضاف مرتين.
    const fulfillment: 'pickup' | 'delivery' = order?.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    const deliveryFee = Number(order?.deliveryFee) > 0 ? Number(order.deliveryFee) : undefined;
    const qty = Number(order?.bookedQuantity) || 1;
    const unitPrice = Number(deal?.discountedPrice) > 0 ? Number(deal.discountedPrice) : undefined;
    // احتياطي للطلبات القادمة من البوتات (لا تكتب سطر الإجمالي): سعر العرض ×
    // الكمية + رسوم التوصيل. لا يُطبَّق مع النسخ (variants) لأن لكل نسخة سعرها.
    const fallbackTotal = (!pickedVariants.length && unitPrice)
        ? Math.round((unitPrice * qty + (deliveryFee || 0)) * 100) / 100
        : undefined;
    return {
        shopName: deal.shopName || deal.itemName,
        itemName: deal.itemName,
        barcode: order?.barcode,
        backupCode: order?.backupCode,
        createdAt: order?.bookedAt,
        quantity: order?.bookedQuantity,
        buyerName: order?.userName,
        buyerPhone: order?.userPhone,
        unitPrice,
        branchName: (Array.isArray(deal.locations) && order?.locationId)
            ? (deal.locations.find((l: any) => l?.id === order.locationId)?.name || undefined)
            : undefined,
        fulfillment,
        deliveryFee,
        deliveryAddress: order?.deliveryAddress || null,
        prepTime: order?.prepTime,
        items,
        totalText,
        totalAmount: totalAmount ?? fallbackTotal,
        totalIsEstimate: totalAmount == null && fallbackTotal != null,
        buyerNote,
        merchantNote: order?.merchantNote || undefined,
        // v12.93 — حالة الدفع: مدفوع إلكترونياً (paidAt) وإلا الدفع عند الاستلام
        paidOnline: !!order?.paidAt,
        paidAmount: order?.paidAmount,
        paymentMethod: order?.paymentMethod,
        // v13.35 — لجلب الرقم الضريبي للتاجر لحظة الطباعة (توافق الهيئة)
        storeId: deal.storeId || deal.store_id || order?.storeId,
        // v13.13 — حالة الطلب ومن ألغاه (للطلبات المنتهية على الفاتورة)
        status: order?.status,
        cancelledBy: order?.cancelledBy,
        isRTL,
    };
};

const buildHtml = (d: InvoiceData): string => {
    const rtl = d.isRTL;
    const dir = rtl ? 'rtl' : 'ltr';
    const L = (ar: string, en: string) => (rtl ? ar : en);
    // v14.06 — أرقام لاتينية في التاريخ: بقية الفاتورة (الأسعار، الكمية،
    // الباركود) لاتينية، وكان التاريخ وحده بأرقام هندية فيبدو مستنداً آخر —
    // ونسخة البوت PDF تستعمل نفس التنسيق حرفياً فلا يختلف المستندان.
    const dateStr = d.createdAt
        ? new Date(d.createdAt).toLocaleString(rtl ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        : '';
    // v14.06 — كان `${d.prepTime} دقيقة` يطبع «30min دقيقة» لأن القيمة المخزّنة
    // تحمل اللاحقة أصلاً (`20min`). نُجرّد الرقم ثم نضيف الوحدة مرة واحدة.
    const prepMinutes = String(d.prepTime ?? '').replace(/[^\d]/g, '');
    const prep = d.prepTime === 'arrival'
        ? (rtl ? 'عند الوصول' : 'On arrival')
        : (prepMinutes ? `${prepMinutes} ${rtl ? 'دقيقة' : 'min'}` : '');
    const delivery = d.fulfillment === 'delivery';
    const addr = d.deliveryAddress || null;

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
  .delivery { margin-top: 8px; padding: 9px 11px; border-radius: 8px; background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; }
  .delivery .d-main { font-size: 12px; font-weight: 900; line-height: 1.6; }
  .delivery .d-sub { font-size: 11px; font-weight: 700; margin-top: 2px; }
  .delivery .d-geo { font-size: 10px; font-weight: 700; color: #64748b; margin-top: 2px; }
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
  .status { margin-top: 10px; padding: 11px 12px; border-radius: 10px; font-size: 15px; font-weight: 900; text-align: center; border: 2px solid; }
  .status .status-sub { display: block; font-size: 11px; font-weight: 700; margin-top: 3px; }
  .status.done { background: #dcfce7; color: #166534; border-color: #16a34a; }
  .status.void { background: #fee2e2; color: #991b1b; border-color: #dc2626; }
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
      ${(() => {
        // v13.35 — توافق الهيئة: التاجر المسجّل ضريبياً تُطبع له «فاتورة ضريبية
        // مبسطة» باسمها الصحيح ورقمه الضريبي؛ غير المسجّل يبقى «سند طلب».
        // v14.17 — الشرط هو **أن ضريبةً حُصِّلت فعلاً على هذا الطلب** (لقطة الفاتورة)،
        // لا مجرّد صحّة صيغة الرقم. كانت الورقة تُعنون نفسها «فاتورة ضريبية مبسطة»
        // في أعلاها ثم تقول في أسفلها «المتجر غير مسجّل ولم تُحصَّل ضريبة» — مستندٌ
        // يناقض نفسه ولا يصمد أمام أي تدقيق.
        // v14.22 — الشرط **صدور رقم الفاتورة** لا وجود اللقطة. اللقطة تُكتب لحظة
        // الحجز، فطلبٌ أُلغي أو انتهت مهلته كان يُطبع «فاتورة ضريبية مبسطة» برمز
        // زاتكا عن بيعٍ لم يقع — مستندٌ ضريبيّ لمعاملة غير موجودة.
        if (d.invoiceNo && d.vatAmount != null && isValidSaudiVat(d.sellerVatNumber)) {
            return `<div class="sub"><b>${L('فاتورة ضريبية مبسطة', 'Simplified Tax Invoice')}</b><br>${L('الرقم الضريبي', 'VAT No')}: ${esc(String(d.sellerVatNumber))}${d.sellerAddress ? `<br>${esc(String(d.sellerAddress))}` : ''}</div>`;
        }
        return `<div class="sub">${L('فاتورة / سند طلب', 'Order receipt')}</div>`;
      })()}
    </div>
    ${orderBarcodeHtml}
    ${d.invoiceNo ? `<div class="row"><span class="k">${L('رقم الفاتورة', 'Invoice #')}</span><span class="v">${esc(d.invoiceNo)}</span></div>` : ''}
    <div class="row"><span class="k">${L('رقم الطلب', 'Order #')}</span><span class="v">${esc(d.barcode)}</span></div>
    ${d.backupCode && d.backupCode !== d.barcode ? `<div class="row"><span class="k">${L('كود احتياطي', 'Backup code')}</span><span class="v">${esc(d.backupCode)}</span></div>` : ''}
    ${dateStr ? `<div class="row"><span class="k">${L('التاريخ', 'Date')}</span><span class="v">${esc(dateStr)}</span></div>` : ''}
    ${d.buyerName ? `<div class="row"><span class="k">${L('المشتري', 'Buyer')}</span><span class="v">${esc(d.buyerName)}${d.buyerPhone ? ` — ${esc(d.buyerPhone)}` : ''}</span></div>` : ''}
    <div class="row"><span class="k">${L('الكمية', 'Qty')}</span><span class="v">${esc(String(d.quantity))}</span></div>
    ${Number(d.unitPrice) > 0 ? `<div class="row"><span class="k">${L('سعر القطعة', 'Unit price')}</span><span class="v">${fmtSAR(Number(d.unitPrice))} ${L('ر.س', 'SAR')}</span></div>` : ''}
    ${prep ? `<div class="row"><span class="k">${L('وقت التجهيز', 'Prep')}</span><span class="v">${esc(prep)}</span></div>` : ''}
    ${d.branchName ? `<div class="row"><span class="k">${L('الفرع', 'Branch')}</span><span class="v">${esc(d.branchName)}</span></div>` : ''}
    <div class="row"><span class="k">${L('طريقة الاستلام', 'Fulfillment')}</span><span class="v"${delivery ? ' style="color:#1e40af"' : ''}>${delivery ? L('توصيل إلى العنوان', 'Home delivery') : L('استلام من المتجر', 'Pickup at store')}</span></div>
    ${(delivery && addr) ? `<div class="delivery">
      <div class="d-main">${L('التوصيل إلى', 'Deliver to')}: ${esc([addr.label, addr.details, addr.city].filter(Boolean).join(' — ') || L('عنوان المشتري', 'Buyer address'))}</div>
      ${addr.phone ? `<div class="d-sub">${L('جوال التوصيل', 'Delivery phone')}: ${esc(String(addr.phone))}</div>` : ''}
      ${(addr.lat && addr.lng) ? `<div class="d-geo">${L('الإحداثيات', 'Coordinates')}: ${esc(Number(addr.lat).toFixed(5))}, ${esc(Number(addr.lng).toFixed(5))}</div>` : ''}
    </div>` : ''}
    <div class="items">
      ${itemHtml || `<div class="li"><div class="li-name">${esc(d.itemName)}</div></div>`}
    </div>
    ${Number(d.deliveryFee) > 0 ? `<div class="row" style="margin-top:10px"><span class="k">${L('رسوم التوصيل', 'Delivery fee')}</span><span class="v">${fmtSAR(Number(d.deliveryFee))} ${L('ر.س', 'SAR')}</span></div>` : ''}
    ${(() => {
        // v13.30 — تفصيل ضريبة القيمة المضافة. v13.35 (توافق الهيئة): سطر الضريبة
        // يُطبع فقط للتاجر المسجّل ضريبياً — غير المسجّل لا يجوز له تحصيل الضريبة
        // ولا إظهارها، فيُطبع الإجمالي مع إيضاح نظامي.
        if (!(Number(d.totalAmount) > 0)) {
            return d.totalText ? `<div class="total"><span>${L('الإجمالي', 'Total')}</span><span>${esc(d.totalText)}</span></div>` : '';
        }
        const cur = L('ر.س', 'SAR');
        // v14.17 — لا حساب هنا إطلاقاً: الأساس والضريبة رقمان مجمّدان في الفاتورة.
        if (!d.invoiceNo || d.vatAmount == null || d.vatBase == null) {
            return `
    <div class="total"><span>${L('الإجمالي', 'Total')}</span><span>${fmtSAR(Number(d.totalAmount))} ${cur}</span></div>
    <div class="note" style="text-align:center">${L('المتجر غير مسجّل في ضريبة القيمة المضافة — لم تُحصَّل ضريبة على هذا الطلب.', 'Store not VAT-registered — no VAT was charged.')}</div>`;
        }
        const rate = d.vatRate ?? KSA_VAT_RATE;
        return `
    <div class="row" style="margin-top:10px"><span class="k">${L('المجموع قبل الضريبة', 'Subtotal (excl. VAT)')}</span><span class="v">${fmtSAR(Number(d.vatBase))} ${cur}</span></div>
    <div class="row"><span class="k">${L(`ضريبة القيمة المضافة ${rate}٪ (مضمّنة)`, `VAT ${rate}% (included)`)}</span><span class="v">${fmtSAR(Number(d.vatAmount))} ${cur}</span></div>
    <div class="total"><span>${L('الإجمالي شامل الضريبة', 'Total (VAT incl.)')}</span><span>${fmtSAR(Number(d.totalAmount))} ${cur}</span></div>
    ${d.qrDataUrl ? `<div style="text-align:center;margin-top:10px"><img src="${d.qrDataUrl}" alt="ZATCA QR" width="130" height="130"><div style="font-size:9px;color:#94a3b8">${L('رمز الفوترة الإلكترونية — امسحه بتطبيق زاتكا للتحقق', 'ZATCA e-invoicing QR')}</div></div>` : ''}`;
    })()}
    ${d.creditNoteNo ? `
    <div class="delivery" style="margin-top:12px;border-color:#10b981">
      <div class="d-main">${L('إشعار دائن', 'Credit note')} ${esc(d.creditNoteNo)} — ${L('رُدّ المبلغ للمشتري', 'Refunded to the buyer')}</div>
      <div class="d-sub">${L('المبلغ المُعاد', 'Refunded amount')}: ${fmtSAR(Number(d.refundAmount || 0))} ${L('ر.س', 'SAR')}${d.refundRef ? ` — ${L('المرجع', 'Ref')}: ${esc(d.refundRef)}` : ''}</div>
      ${d.refundedAt ? `<div class="d-sub">${L('بتاريخ', 'On')}: ${esc(new Date(d.refundedAt).toLocaleString(rtl ? 'ar-SA-u-ca-gregory' : 'en-GB'))}</div>` : ''}
    </div>` : ''}
    ${d.totalIsEstimate && Number(d.totalAmount) > 0 ? `<div class="foot" style="margin-top:8px">${L('الإجمالي محسوب من سعر العرض وقد لا يشمل إضافات اتُّفق عليها مع التاجر.', 'Total is derived from the deal price and may exclude extras agreed with the merchant.')}</div>` : ''}
    ${(() => {
        // v13.13 — بانر حالة الطلب على الفاتورة (طلب ناصر): الملغي لا تُطبع له
        // «طريقة الدفع» (لم تتم محاسبة)، بل «الطلب ملغي» مع ذكر من ألغاه؛ والمكتمل
        // يُطبع «الطلب مكتمل» + كيف حوسب العميل (نقداً/إلكترونياً).
        if (d.status === 'cancelled') {
            // v14.21 — طلبٌ رُدّ مبلغه: «لم تتم أي محاسبة على العميل» كذبٌ صريح
            // على ورقة تحمل فوقها إشعاراً دائناً بـ٩٠٠ ريال. حُوسب ثم رُدّ.
            if (d.cancelledBy === 'refund' || d.creditNoteNo) {
                return `<div class="status void">${L('❌ الطلب ملغي بعد ردّ المبلغ', '❌ Cancelled after refund')}<span class="status-sub">${L('حُوسب العميل ثم رُدّ إليه المبلغ', 'The buyer was charged and then refunded')}${d.creditNoteNo ? ` — ${L('إشعار دائن', 'credit note')} ${esc(d.creditNoteNo)}` : ''}</span></div>`;
            }
            const who = d.cancelledBy === 'buyer'
                ? L('أُلغِي من العميل', 'Cancelled by the buyer')
                : d.cancelledBy === 'seller'
                    ? L('أُلغِي من التاجر', 'Cancelled by the merchant')
                    : (d.cancelledBy === 'expired' || d.cancelledBy === 'system')
                        ? L('أُلغِي تلقائياً (انتهت مهلة الاستلام)', 'Auto-cancelled (pickup window expired)')
                        : L('أُلغِي', 'Cancelled');
            return `<div class="status void">${L('❌ الطلب ملغي', '❌ Order cancelled')}<span class="status-sub">${who} — ${L('لم تتم أي محاسبة على العميل', 'No charge was made')}</span></div>`;
        }
        // v14.06 — ثلاث حالات لا اثنتان: مدفوع · إلكتروني بانتظار السداد ·
        // عند الاستلام/التوصيل. كان غير المسدَّد إلكترونياً يُطبع «استلم نقداً»
        // فيطالب التاجرُ عميلاً سيدفع ببطاقته — لبس محاسبي حقيقي.
        const pendingOnline = !d.paidOnline && d.paymentMethod === 'online';
        const payHtml = `<div class="pay ${d.paidOnline ? 'paid' : 'cod'}">${d.paidOnline
            ? `${L('✅ مدفوع إلكترونياً', '✅ Paid online')}<span class="pay-sub">${L('وصل حساب التاجر — لا تطلب مبلغاً من العميل', 'Sent to merchant — do not collect cash')}${d.paidAmount != null ? ` (${fmtSAR(Number(d.paidAmount))} ${L('ر.س','SAR')})` : ''}</span>`
            : pendingOnline
                ? `${L('💳 الدفع إلكتروني — بانتظار السداد', '💳 Online payment — pending')}<span class="pay-sub">${L('يُسدَّد عبر بوابة التاجر قبل التسليم', 'Paid via the merchant’s gateway before handover')}</span>`
                : `${delivery ? L('💵 الدفع عند التوصيل', '💵 Pay on delivery') : L('💵 الدفع عند الاستلام', '💵 Pay at pickup')}<span class="pay-sub">${L('استلم المبلغ نقداً/شبكة من العميل', 'Collect payment from the buyer')}</span>`}</div>`;
        const doneHtml = d.status === 'completed'
            ? `<div class="status done">${L('✅ الطلب مكتمل', '✅ Order completed')}<span class="status-sub">${d.creditNoteNo
                ? `${L('حوسب العميل ثم رُدّ إليه المبلغ', 'Charged and then refunded')} — ${L('إشعار دائن', 'credit note')} ${esc(d.creditNoteNo)}`
                : d.paidOnline ? L('حوسب العميل إلكترونياً — وصل حساب التاجر', 'Charged online — sent to merchant') : L('حوسب العميل عند الاستلام (نقداً/شبكة)', 'Charged at pickup (cash/card)')}</span></div>`
            : '';
        return payHtml + doneHtml;
    })()}
    ${d.buyerNote ? `<div class="note">📝 ${L('ملاحظة المشتري', 'Buyer note')}: ${esc(d.buyerNote)}</div>` : ''}
    ${d.merchantNote ? `<div class="note">💬 ${L('ملاحظة التاجر', 'Merchant note')}: ${esc(d.merchantNote)}</div>` : ''}
    <div class="stamp">
      <div class="box">${L('توقيع/ختم التاجر', 'Merchant stamp')}</div>
      <div class="box">${L('استلمت الطلب', 'Received')}</div>
    </div>
    <div class="foot">${isValidSaudiVat(d.sellerVatNumber)
        ? L('فاتورة ضريبية مبسطة صادرة إلكترونياً عبر منصة تاكي نيابةً عن المتجر (المرحلة الأولى من الفوترة الإلكترونية).', 'Simplified tax invoice issued electronically via TAKI on behalf of the store.')
        : L('صادرة عبر منصة تاكي — سند تشغيلي وليس فاتورة ضريبية. الفاتورة الضريبية (زاتكا) تصدر من نظام التاجر.', 'Issued via TAKI — operational receipt, not a tax invoice.')}<br>www.takisa.net</div>
  </div>
</body>
</html>`;
};

// v13.08 — نعرض الفاتورة كطبقة داخل التطبيق (لا تبويب جديد). على آيفون PWA كان
// التبويب الجديد يجعل «اطبع الآن» (window.print) و«عودة للتطبيق» (window.close/
// history.back) لا تعمل — بلاغ ناصر. الآن الفاتورة داخل iframe مستقل (عزل الطباعة)
// فوق التطبيق، والأزرار يتحكّم بها التطبيق: «اطبع» يطبع الـiframe فقط، و«عودة»
// تُزيل الطبقة وتُبقيك في مكانك بالتطبيق. زر أندرويد الخلفي يُغلقها أيضاً.
// v13.57 — بلاغ ناصر: «الطباعة تتأخر، وإن ضغطت مرات دخلت الفاتورة واحتجت عودة
// ٣ مرات». السبب: جلب الرقم الضريبي (طلب شبكة) كان يسبق ظهور أي شيء على الشاشة،
// فيبدو الزر متجمداً؛ ولأن لا حارس، كل نقرة كانت تبني طبقة فاتورة مستقلة تتكدّس
// فوق سابقتها فيلزم «عودة» بعددها. الآن: الطبقة تظهر فوراً وفيها «جارٍ التجهيز»،
// وحارس وحيد يتجاهل النقرات الإضافية حتى تُغلق الطبقة.
let invoiceOverlayOpen = false;

export const printOrderInvoice = async (data: InvoiceData): Promise<void> => {
    if (invoiceOverlayOpen) return;
    invoiceOverlayOpen = true;

    const rtl = data.isRTL;
    const L = (ar: string, en: string) => (rtl ? ar : en);

    const overlay = document.createElement('div');
    overlay.dir = rtl ? 'rtl' : 'ltr';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#f8fafc;display:flex;flex-direction:column;';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;justify-content:center;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;background:#0f172a;flex-shrink:0;';
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.textContent = L('⏳ جارٍ التجهيز…', '⏳ Preparing…');
    printBtn.disabled = true;
    printBtn.style.cssText = 'font-size:15px;font-weight:800;padding:12px 22px;border-radius:12px;border:none;background:#64748b;color:#fff;cursor:progress;';
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

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        invoiceOverlayOpen = false;
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevBodyOverflow;
        try { document.body.removeChild(overlay); } catch { /* ignore */ }
    };
    // Esc يُغلق أيضاً (ديسكتوب). لا نلمس سجل المتصفح حتى لا نتضارب مع الراوتر.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    backBtn.onclick = close;

    // v13.35 — توافق الهيئة: اجلب الرقم الضريبي للمتجر لحظة الطباعة، وإن كان
    // مسجّلاً ولّد رمز QR (TLV) محلياً — فتخرج «فاتورة ضريبية مبسطة» مكتملة.
    // كل خطوة best-effort: أي فشل يطبع السند كما كان ولا يعطّل الزر أبداً.
    // v14.17 — كل ما يخصّ الضريبة يأتي من **لقطة الفاتورة** على القاعدة.
    // 🪤 ما كان قبلها: الرقم الضريبي يُقرأ حيّاً من `store_profiles` لحظة الضغط،
    // والنسبة ثابتة ١٥ في الكود، والتقسيم يُعاد حسابه هنا — فثلاث نسخ مستقلّة
    // (الموقع · ملفّ البوتين · القاعدة) تختلف على الطلب الواحد، وفاتورةٌ قديمة
    // تتغيّر أرقامها كلّما عدّل التاجر بياناته.
    try {
        if (data.barcode && data.vatAmount === undefined) {
            const { data: inv } = await supabase.rpc('get_order_invoice', { p_barcode: data.barcode });
            const v: any = inv || null;
            if (v) {
                data.invoiceNo = v.invoice_no ?? null;
                data.issuedAt = v.issued_at ?? null;
                data.vatRate = v.vat_rate != null ? Number(v.vat_rate) : null;
                data.vatBase = v.vat_base != null ? Number(v.vat_base) : null;
                data.vatAmount = v.vat_amount != null ? Number(v.vat_amount) : null;
                // v14.68 — الإجمالي المطبوع من اللقطة نفسها التي بُني منها الرمز.
                // بدونها يُطبع رقمٌ من الحجز ويُرمَّز رقمٌ من الفاتورة على ورقة واحدة.
                if (Number(v.total) > 0) {
                    data.totalAmount = Number(v.total);
                    // ولم يعد تقديراً: الرقم من اللقطة المجمّدة. بدون هذا السطر
                    // تبقى الورقة تقول «الإجمالي محسوب من سعر العرض» تحت رقمٍ
                    // مأخوذٍ من الفاتورة نفسها — نصٌّ يكذّب الرقم الذي فوقه.
                    data.totalIsEstimate = false;
                }
                data.zatcaTlv = v.zatca_tlv ?? null;
                data.sellerVatNumber = v.seller?.vat_number ?? null;
                data.sellerAddress = v.seller?.address ?? null;
                if (v.seller?.name) data.shopName = String(v.seller.name);
            }
        }
        // v14.18 — إشعار دائن إن رُدّ المبلغ.
        if (data.barcode && data.creditNoteNo === undefined) {
            const { data: rf } = await supabase.rpc('get_booking_refund', { p_barcode: data.barcode });
            const r: any = rf || null;
            if (r && r.status === 'refunded') {
                data.creditNoteNo = r.credit_note_no ?? null;
                data.refundAmount = r.refund_amount != null ? Number(r.refund_amount) : null;
                data.refundRef = r.refund_ref ?? null;
                data.refundedAt = r.refunded_at ?? null;
            } else {
                data.creditNoteNo = null;
            }
        }
        // رمز الفوترة الإلكترونية يُبنى من أرقام اللقطة نفسها — لا من حسابٍ محلّي،
        // وإلا حمل الرمزُ مبلغاً غير الذي تقرؤه العين على نفس الورقة.
        // v14.68 — الرمز **يأتي مُرمَّزاً من القاعدة**. كان يُرمَّز هنا وفي ملفّ
        // البوت معاً، و**اختلف المخرجان فعلاً** لاسم بائعٍ أطول من ٢٥٥ بايتاً —
        // أي رمزان على مستندٍ ضريبيّ واحد. صار `taki_zatca_tlv` مصدراً واحداً،
        // ويبقى فحص صيغة الرقم الضريبي هنا فلا يُطبع رمزٌ لرقمٍ مشوّه.
        if (data.zatcaTlv && isValidSaudiVat(data.sellerVatNumber) && !data.qrDataUrl) {
            data.qrDataUrl = await qrFromTlv(data.zatcaTlv);
        }
    } catch { /* السند يُطبع بلا QR عند أي فشل */ }

    if (closed) return;   // أُغلقت الطبقة أثناء الانتظار — لا تكتب في iframe مُزال

    const doc = iframe.contentWindow?.document;
    if (doc) { doc.open(); doc.write(buildHtml(data)); doc.close(); }

    printBtn.disabled = false;
    printBtn.textContent = L('🖨 اطبع الآن', '🖨 Print now');
    printBtn.style.background = '#10b981';
    printBtn.style.cursor = 'pointer';
    printBtn.onclick = () => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
    };
};
