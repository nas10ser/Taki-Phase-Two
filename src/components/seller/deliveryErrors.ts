/**
 * deliveryErrors — مفرداتُ أخطاء خدمة التوصيل (v15.44، خرجت من `DeliveryCard`)
 * ═══════════════════════════════════════════════════════════════════════════
 * خرجت لأن `DeliveryCard` عند سقفه بالضبط، ولأنها **جدولُ بيانات** لا منطقَ
 * عرض: رمزُ خطأٍ من القاعدة ⇒ جملةٌ بالعربية والإنجليزية. ووجودُها في ملفٍّ
 * واحد يجعل تحديثَ رسالةٍ بعد تغييرِ شاشةٍ تعديلاً في موضعٍ واحد يُقرأ.
 *
 * 🪤 وترتيبُ الصفوف جزءٌ من العقد: الفحصُ بـ`includes`، فالأعمُّ لو سبق
 *    الأخصَّ ابتلعه وظهرت رسالةٌ خاطئة (`points` قبل `points_count`).
 */
export const ERRORS: Array<[string, string, string]> = [
    ['AUTH_REQUIRED', 'انتهت جلستك — أعد تسجيل الدخول', 'Your session expired — sign in again'],
    ['SELLER_ONLY', 'خدمة التوصيل لحسابات المتاجر فقط', 'Delivery is for store accounts only'],
    ['BAD_MODE', 'طريقة دفع غير معروفة', 'Unknown payment mode'],
    // v15.44 — كانت تُحيل إلى بطاقة «طريقة الحساب»، وهي تختفي بعد الإقرار
    // (أمرُ ناصر). والمرجعُ الآن حيث يُضبط الأمرُ فعلاً: «طرق الدفع المتاحة
    // لعملائك» داخل بطاقة بوّابة الدفع. 🪤 ورسالةٌ تُحيل إلى شاشةٍ غير ظاهرة
    //    أسوأ من رسالةٍ عامّة — تُرسل التاجرَ يبحث عمّا لا يجده.
    ['COD_VS_CARD_ONLY', 'متجرك مضبوط على «إلكتروني فقط» في «طرق الدفع المتاحة لعملائك» داخل بطاقة 💳 بوابة الدفع، فلا يُقبل النقد عند التوصيل. غيّرها هناك، أو اختر «بطاقة فقط» هنا', 'Your store is set to “Card only” under “Payment methods available to your customers” in the 💳 Payment gateway card, so cash on delivery cannot be accepted. Change it there, or pick “Card only” here'],
    ['BAD_FEE', 'رسوم التوصيل يجب أن تكون بين ٠ و١٠٠٠ ريال', 'The delivery fee must be between 0 and 1000 SAR'],
    ['BAD_MIN', 'الحد الأدنى للطلب غير منطقي', 'The minimum order value is not valid'],
    ['BAD_ETA', 'مدة التوصيل يجب أن تكون بين ٠ و١٤٤٠ دقيقة', 'Delivery time must be between 0 and 1440 minutes'],
    ['GATEWAY_REQUIRED', 'اختيار «بطاقة» يتطلّب تفعيل بوابة الدفع أولاً من بطاقة «💳 بوابة الدفع» أعلاه — وإلا لن يستطيع المشتري الدفع', 'Choosing “Card” requires an active payment gateway (the “💳 Payment gateway” card above) — otherwise buyers cannot pay'],
    ['TAKI_ZONE_CAP:10',
        'وصلت الحد الأقصى: ١٠ نطاقات فعّالة لمتجرك كله (لا لكل فرع). عطّل نطاقاً أو احذفه قبل إضافة غيره',
        'Limit reached: 10 active zones for the whole store (not per branch). Disable or delete one first'],
    ['TAKI_ZONE_BAD:not_store', 'هذه الخاصية لحسابات المتاجر فقط', 'This feature is for store accounts only'],
    ['TAKI_ZONE_BAD:branch', 'الفرع المختار لا يخصّ متجرك — أعد اختيار الفرع', 'That branch does not belong to your store — pick it again'],
    ['TAKI_ZONE_BAD:circle', 'مركز الدائرة أو نصف قطرها غير صالح (نصف القطر بين ٠.٢ و٢٠٠ كم)', 'Invalid circle centre or radius (radius 0.2–200 km)'],
    // ⚠️ الترتيب مقصود: `points_count` قبل `points` لأن الفحص بـ`includes`
    // فلو سبقت الأعمّ لابتلعت الأخصّ وظهرت رسالة خاطئة.
    ['TAKI_ZONE_BAD:points_count', 'المستطيل يحتاج ركنين بالضبط، والمضلّع من ٣ إلى ٨٠ نقطة', 'A rectangle needs exactly 2 corners, a polygon 3 to 80 points'],
    ['TAKI_ZONE_BAD:points', 'شكل النطاق غير صالح — أعد الرسم', 'The zone shape is invalid — draw it again'],
    ['TAKI_ZONE_BAD:point', 'إحدى النقاط خارج الحدود الجغرافية الصالحة', 'One of the points is outside valid geographic bounds'],
    ['TAKI_ZONE_BAD:fee', 'رسوم النطاق يجب أن تكون بين ٠ و١٠٠٠ ريال', 'The zone fee must be between 0 and 1000 SAR'],
];

export const errMsg = (e: unknown, isRTL: boolean): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    for (const [key, ar, en] of ERRORS) if (raw.includes(key)) return isRTL ? ar : en;
    return raw || (isRTL ? 'خطأ غير معروف' : 'Unknown error');
};
