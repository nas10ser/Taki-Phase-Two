/**
 * vat.ts — ضريبة القيمة المضافة السعودية (v13.30)
 *
 * المصدر الموحّد لكل حسابات الضريبة في الواجهة. الأسعار المعروضة للمستهلك في
 * السعودية يجب أن تكون شاملة الضريبة (نظام ضريبة القيمة المضافة — المادة ٥٣)،
 * لذلك أسعار العروض تُعامل «شاملة» والضريبة تُستخرج منها لا تُضاف فوقها.
 *
 * قاعدة التقريب (بدون فروقات هللة): تُقرَّب الضريبة أولاً لأقرب هللة، ثم
 * الأساس = الإجمالي − الضريبة المقرَّبة — فيبقى (الأساس + الضريبة = الإجمالي)
 * صحيحاً دائماً مهما كان الرقم.
 */

export const KSA_VAT_RATE = 15;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** قيمة الضريبة المضمّنة داخل سعر شامل. مثال: 20 ← 2.61 */
export const vatFromInclusive = (gross: number, rate: number = KSA_VAT_RATE): number => {
    if (!Number.isFinite(gross) || gross <= 0) return 0;
    return round2((gross * rate) / (100 + rate));
};

/** الأساس قبل الضريبة من سعر شامل. مثال: 20 ← 17.39 (الأساس + الضريبة = الإجمالي دائماً) */
export const baseFromInclusive = (gross: number, rate: number = KSA_VAT_RATE): number => {
    if (!Number.isFinite(gross) || gross <= 0) return 0;
    return round2(gross - vatFromInclusive(gross, rate));
};

/** تفكيك سعر شامل إلى {أساس، ضريبة، إجمالي} بتقريب مقفول الحساب. */
export const splitInclusive = (gross: number, rate: number = KSA_VAT_RATE): { base: number; vat: number; total: number } => {
    const vat = vatFromInclusive(gross, rate);
    return { base: round2(gross - vat), vat, total: round2(gross) };
};

/** ضريبة تُضاف فوق سعر غير شامل (تستخدمها فواتير الاشتراك إذا اختار الأدمن «تُضاف فوق السعر»). */
export const vatOnTop = (net: number, rate: number = KSA_VAT_RATE): number => {
    if (!Number.isFinite(net) || net <= 0) return 0;
    return round2((net * rate) / 100);
};

/** تنسيق مبلغ بهللتين (أرقام لاتينية ثابتة للفواتير). */
export const fmtSAR = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(2);
