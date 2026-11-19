import { computeBookingLocation } from './bookingLocationRule';
import type { BookingLocationInput } from './bookingLocationRule';
import { CITIES, geoName } from '../data/mock';

/**
 * سؤالُ الموقع قبل الحجز — الرسائلُ والتدفّق (v16.47)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر: «قبل الحجز تأكّد من أن اللوكيشن يعمل، فقد يحجز في منطقةٍ غير
 *    منطقته — أو اجعله يحطّ المدينة التي هو فيها».
 *
 * 🪤 وملفٌّ مستقلٌّ لا كتلةٌ في `DealDetails.tsx`: ذاك مُعلَنٌ ضخماً (٣٥٠٤)
 *    ولا يُسمح له أن ينمو — فالنداءُ هناك **سطرٌ واحد** وكلُّ المنطق هنا.
 * 🪤 والقرارُ نفسُه في `bookingLocationRule.ts` (خالصٌ ومُختبَرٌ بالتنفيذ)؛
 *    هذا الملفُّ يصوغ الرسالةَ ويُدير التدفّق لا غير.
 *
 * 🔴 **ولا يُمنع الحجزُ في أيّ فرع.** أقصى ما يقع: سؤالٌ يُجاب عنه بنعم.
 *    مشترٍ مسافرٌ أو يشتري لأهله حالةٌ مشروعةٌ شائعة، ومنعُه يُفسد بيعاً صحيحاً.
 */

const cityName = (id?: string | null, isRTL = true): string => {
    if (!id) return '';
    const c = CITIES.find((x) => x.id === id);
    return (c ? geoName(c, isRTL ? 'ar' : 'en') : '') || id;
};

export interface BookingLocationUi {
    isRTL: boolean;
    customAlert: (msg: string) => Promise<unknown> | void;
    customConfirm: (msg: string) => Promise<boolean>;
    /** يفتح إذنَ الموقع ويبدأ التتبّع — نفسُ النداء الذي تستعمله بوّابةُ الموقع. */
    requestLiveLocation: () => Promise<{ lat: number; lng: number } | null>;
}

/**
 * يُرجع `true` إن جاز المضيّ في الحجز، و`false` إن أوقفه المستخدم أو لم
 * يُحدَّد موقعُه.
 */
export const confirmBookingLocation = async (
    input: BookingLocationInput & { dealCityName?: string | null },
    ui: BookingLocationUi,
): Promise<boolean> => {
    let r = computeBookingLocation(input);

    // ① لا نعرف أين هو ⇒ نطلب الإذن مرّةً. ونُعيد الحسابَ بما عاد به فعلاً.
    if (r.action === 'ask-location') {
        const ok = await ui.customConfirm(ui.isRTL
            ? '📍 حدّد موقعك قبل الحجز\nحتى لا تحجز من متجرٍ في مدينةٍ أخرى بلا قصد. نفتح إذن الموقع الآن؟'
            : '📍 Set your location before booking\nSo you do not book from a store in another city by mistake. Enable location now?');
        if (!ok) {
            // 🪤 ولا يُمنع: رفضُ الإذن ليس خطأً، ولمن رفضه طريقٌ آخر (اختيارُ
            //    المدينة من الرئيسية). فيُقال له ذلك ويمضي الحجز.
            await ui.customAlert(ui.isRTL
                ? 'ℹ️ تابعتَ بلا تحديد موقع. تأكّد بنفسك أن المتجر في مدينتك قبل الذهاب — ويمكنك تحديد مدينتك من الصفحة الرئيسية.'
                : 'ℹ️ Continuing without a location. Please check the store is in your city before going — you can set your city from the home page.');
            return true;
        }
        const fix = await ui.requestLiveLocation();
        if (!fix) {
            await ui.customAlert(ui.isRTL
                ? '⚠️ تعذّر تحديد موقعك. يمكنك اختيار مدينتك من الصفحة الرئيسية — وتابع الحجز إن كنت متأكّداً من المتجر.'
                : '⚠️ Could not get your location. You can pick your city from the home page — continue if you are sure about the store.');
            return true;
        }
        r = computeBookingLocation({ ...input, buyerLat: fix.lat, buyerLng: fix.lng });
    }

    // ② نعرفه وهو بعيد ⇒ تأكيدٌ يذكر المدينةَ والمسافة.
    if (r.action === 'confirm-far') {
        const where = input.dealCityName || cityName(input.dealCityId, ui.isRTL) || '';
        const far = r.km != null ? (ui.isRTL ? ` (تبعد نحو ${Math.round(r.km)} كم عنك)` : ` (~${Math.round(r.km)} km away)`) : '';
        return ui.customConfirm(ui.isRTL
            ? `📍 هذا المتجر${where ? ` في ${where}` : ''}${far}\nوالاستلام من المتجر نفسه. متأكّد أنك تريد الحجز؟`
            : `📍 This store is${where ? ` in ${where}` : ''}${far}\nPickup is from the store itself. Continue booking?`);
    }

    return true;
};
