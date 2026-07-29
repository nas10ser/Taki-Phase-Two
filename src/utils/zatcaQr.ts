/**
 * zatcaQr.ts — رمز QR للفوترة الإلكترونية (المرحلة الأولى — v13.35)
 *
 * الهيئة تشترط على «الفاتورة الضريبية المبسطة» رمز QR **قابلاً للمسح** يحمل
 * خمسة حقول بترميز TLV ثم Base64:
 *   1: اسم البائع   2: الرقم الضريبي   3: التاريخ ISO   4: الإجمالي شامل الضريبة   5: الضريبة
 * (كنا نطبع النص Base64 فقط — وهو غير قابل للمسح، أي غير مطابق.)
 *
 * التوليد محلي بالكامل (مكتبة qrcode داخل الحزمة) — بيانات الفاتورة لا تُرسل
 * لأي خدمة خارجية، والناتج Data URL يُدمج في HTML الفاتورة المطبوعة مباشرة.
 */
import QRCode from 'qrcode';
import { zatcaTlvBase64, invoiceAmounts, InvoicePayment, InvoiceTaxSettings } from './invoice';

export interface ZatcaFields {
    sellerName: string;
    vatNumber: string;
    isoDateTime: string;    // ISO 8601
    totalWithVat: string;   // "115.00"
    vatAmount: string;      // "15.00"
}

/** Data URL لصورة QR مطابقة للمرحلة الأولى — ترجع '' عند أي فشل (لا تكسر الطباعة أبداً). */
export const zatcaQrDataUrl = async (f: ZatcaFields): Promise<string> => {
    try {
        const tlv = zatcaTlvBase64(f.sellerName, f.vatNumber, f.isoDateTime, f.totalWithVat, f.vatAmount);
        if (!tlv) return '';
        return await QRCode.toDataURL(tlv, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 220,
        });
    } catch {
        return '';
    }
};

/** صيغة الرقم الضريبي السعودي: ١٥ رقماً يبدأ وينتهي بـ«3». */
export const isValidSaudiVat = (v?: string | null): boolean =>
    /^3\d{13}3$/.test(String(v || '').trim());

/** QR لفاتورة اشتراك — بنفس أرقام buildInvoiceHtml حرفياً (مصدر واحد). */
export const invoiceQrForPayment = async (p: InvoicePayment, s: InvoiceTaxSettings): Promise<string> => {
    const { vat, total, dt, isTax } = invoiceAmounts(p, s);
    if (!isTax) return '';
    return zatcaQrDataUrl({
        sellerName: s.entity_name,
        vatNumber: s.vat_number || '',
        isoDateTime: dt.toISOString(),
        totalWithVat: total.toFixed(2),
        vatAmount: vat.toFixed(2),
    });
};
