/**
 * «هل أنت في منطقة هذا العرض؟» — القرارُ خالصاً قبل الحجز (v16.47)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «قبل الحجز تأكّد من أن اللوكيشن يعمل، فقد
 *    يحجز في منطقةٍ غير منطقته — أو اجعله يحطّ المدينة التي هو فيها».
 *
 *    والعيبُ الذي يسدّه حقيقيّ وصامت: مشترٍ في الرياض يحجز **استلاماً من
 *    المتجر** في الدمام ولا شيء يقول له. لا الخادمُ يمنعه (الحجزُ صحيحٌ
 *    تقنيّاً) ولا الشاشةُ تنبّهه — ويكتشفه عند الذهاب.
 *
 * ── ثلاثةُ مخرجاتٍ لا أكثر ────────────────────────────────────────────────
 *   · `ok`            — امضِ بلا سؤال.
 *   · `ask-location`  — لا نعرف أين هو أصلاً ⇒ يُطلب تحديدُ الموقع/المدينة.
 *   · `confirm-far`   — نعرفه، وهو بعيدٌ عن المتجر ⇒ تأكيدٌ يذكر المدينتين.
 *
 * 🔴 **والتوصيلُ يُستثنى كلّه.** العنوانُ هو ما يهمّ هناك لا موضعُ الجهاز،
 *    وله حارسُه في القاعدة (من خارج نطاق التوصيل لا يستطيع اختياره أصلاً).
 *    فسؤالُ «أين أنت؟» لمن يطلب توصيلاً إلى بيته **سؤالٌ في غير محلّه**.
 *
 * 🔴 **ولا يُمنع الحجزُ أبداً — يُسأل فقط.** مشترٍ مسافرٌ، أو يشتري لأهله في
 *    مدينةٍ أخرى، أو يحجز اليوم ليستلم غداً حين يصل: كلُّها حالاتٌ مشروعةٌ
 *    شائعة. فالمنعُ يُفسد بيعاً صحيحاً، والتأكيدُ يكفي.
 *
 * 🪤 **والمسافةُ تسبق المدينة متى توفّرت**: مقارنةُ أسماء المدن تُخطئ عند
 *    الأطراف (الخبر والدمام متلاصقتان، ومشترٍ على الحدّ بينهما يُنذَر بلا
 *    سبب). فإن عرفنا إحداثيّي الطرفين حسبنا الكيلومترات، ولا نلجأ إلى
 *    المدينة إلّا حين تغيب الإحداثيّات.
 *
 * 🪤 ولا يُنذَر عند غياب المعرفة: إنذارٌ بلا يقينٍ يُدرّب المشتري على تجاهل
 *    التأكيدات — وحينها لا ينفع يوم يكون الإنذارُ صحيحاً.
 */

export type BookingLocationAction = 'ok' | 'ask-location' | 'confirm-far';

export interface BookingLocationInput {
    /** التوصيلُ يُستثنى: العنوانُ هو الحَكَم لا موضعُ الجهاز. */
    fulfillment: 'pickup' | 'delivery';
    /** موضعُ الجهاز إن سمح المشتري — الأدقّ. */
    buyerLat?: number | null;
    buyerLng?: number | null;
    /** المدينةُ التي اختارها المشتري (`homeCity`) — بديلٌ حين لا GPS. */
    buyerCityId?: string | null;
    /** مدينةُ العرض كما يعلنها التاجر. */
    dealCityId?: string | null;
    /** إحداثيّا الفرع المختار إن وُجدا. */
    dealLat?: number | null;
    dealLng?: number | null;
    /** ما فوقه يُسأل. الافتراضُ ٦٠ كم — داخلَ المدينة الواحدة وضواحيها. */
    maxKm?: number;
}

export interface BookingLocationResult {
    action: BookingLocationAction;
    /** المسافةُ بالكيلومترات حين تُحسب — للعرض في الرسالة. */
    km: number | null;
    /** أساسُ القرار: مفيدٌ في الاختبار وفي فهم الرسالة. */
    basis: 'distance' | 'city' | 'unknown' | 'delivery';
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return Number.isFinite(n) ? (n as number) : null;
};

/** هافرساين — نفسُ صيغة `find_nearest_sa_city` في القاعدة. */
export const kmBetween = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

export const DEFAULT_MAX_KM = 60;

export const computeBookingLocation = (i: BookingLocationInput): BookingLocationResult => {
    if (i.fulfillment === 'delivery') return { action: 'ok', km: null, basis: 'delivery' };

    const maxKm = Number.isFinite(i.maxKm as number) && (i.maxKm as number) > 0
        ? (i.maxKm as number) : DEFAULT_MAX_KM;

    const bLat = num(i.buyerLat), bLng = num(i.buyerLng);
    const dLat = num(i.dealLat), dLng = num(i.dealLng);

    // ① المسافةُ أوّلاً — أدقُّ من أسماء المدن وأعدلُ عند الأطراف.
    if (bLat !== null && bLng !== null && dLat !== null && dLng !== null) {
        const km = kmBetween(bLat, bLng, dLat, dLng);
        return { action: km > maxKm ? 'confirm-far' : 'ok', km, basis: 'distance' };
    }

    // ② فإن غابت الإحداثيّات: المدينتان — ولا يُقارَن إلّا متى عُرفتا معاً.
    const bCity = (i.buyerCityId || '').trim();
    const dCity = (i.dealCityId || '').trim();
    if (bCity && dCity) {
        return { action: bCity === dCity ? 'ok' : 'confirm-far', km: null, basis: 'city' };
    }

    // ③ ولا نعرف أين هو ⇒ يُسأل. وهذا نصُّ أمر ناصر: «تأكّد من أن اللوكيشن
    //    يعمل — أو اجعله يحطّ المدينة التي هو فيها».
    // 🪤 ولا يُسأل إن كنّا لا نعرف **مكان المتجر** أصلاً: سؤالٌ لا يُفيد،
    //    لأننا لن نستطيع المقارنةَ حتى بعد أن يُجيب.
    if (!dCity && (dLat === null || dLng === null)) {
        return { action: 'ok', km: null, basis: 'unknown' };
    }
    return { action: 'ask-location', km: null, basis: 'unknown' };
};
