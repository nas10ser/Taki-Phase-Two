/**
 * dealAvailability.ts — «هل ينفد هذا العرض؟» بتعريفٍ واحد (v15.07)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجد: الشرطُ كان مكتوباً **خمس مرّات** في الموقع، و**إحداها
 *    خاطئة**: `SellerDashboard.tsx` كان يحسب «نفد» بـ`quantity <= 0` وحدها
 *    بلا شرط السقف، فعرضٌ زمنيّ بلا سقف (ينتهي بالوقت لا بالكمّية) يظهر
 *    «نفد» في قائمة التاجر بينما بطاقتُه على نفس البيانات تقول «⏱ عرض زمني».
 *    نسختان من قاعدةٍ واحدة تنحرفان — وهو النمطُ الذي كلّفنا إصدارات.
 *
 * 🪤 والشرطُ الثالث ليس زينة: `initialQuantity > 0` يعني «التاجر سقّف كمّيته
 *    فعلاً». وبدونه كلُّ عرضٍ زمنيّ (كمّيتُه صفرٌ لأنها غير مستعملة) يُوسم
 *    «نفد» ويُحجب عن البيع. وهو منسوخٌ حرفياً من قاعدة البيانات:
 *    `v_capped := NOT is_unlimited AND COALESCE(initial_quantity,0) > 0`
 *    في `tr_reserve_booking_stock` و`adjust_deal_quantity`.
 *
 * 🪤 وتوأمُه في البوتين `server/lib/stockView.js` — نسختان لأن البيئتين
 *    لا تتشاركان وحدات، و`scripts/check-stock-model.js` يحرس تطابقهما.
 */
import type { Deal } from '../data/mock';

/** أي شكلٍ يحمل حقول المخزون — الصفحاتُ تمرّر `Deal` أو صفّاً خاماً. */
type StockShape = Pick<Deal, 'quantity'> & {
    initialQuantity?: number | 'unlimited';
    soldOut?: boolean | null;
};

/** هل سقّف التاجر كمّيته فعلاً؟ (غيرُ المسقوف لا ينفد أبداً.) */
export const hasStockCap = (d: StockShape): boolean =>
    d.quantity !== 'unlimited'
    && typeof d.initialQuantity === 'number'
    && d.initialQuantity > 0;

/**
 * هل نفد؟ — إمّا أن يرفع التاجر مفتاح «نفد» يدوياً (v15.07)، وإمّا أن
 * يَنفَد عدّادُ المتاح على عرضٍ مسقوف.
 * 🪤 والمفتاحُ اليدويّ أوّلاً: يوقف البيع **ولا يمسّ** رقم التاجر، فلا يفقد
 *    «كم عنده فعلاً» — وهو ما بُني في v15.02.
 */
export const isDealSoldOut = (d: StockShape): boolean => {
    if (d.soldOut === true) return true;
    return hasStockCap(d) && typeof d.quantity === 'number' && d.quantity <= 0;
};

/** المتاحُ للبيع الآن كرقم، أو `null` لعرضٍ بلا حدّ. */
export const availableOf = (d: StockShape): number | null =>
    d.quantity === 'unlimited' ? null : (typeof d.quantity === 'number' ? d.quantity : null);

export default isDealSoldOut;
