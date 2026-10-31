/**
 * bookingPreflight — ما يمنع الحجز يُقال **على صفحة العرض** (v15.36)
 *
 * ── بلاغ ناصر ──────────────────────────────────────────────────────────────
 * «لو لم يُختر منتج أو كانت المسافة بعيدة وضُغط الحجز، اجعله لا يتمّ من نفس
 *  الصفحة — لا من الصفحة التي بعدها. من هنا أفضل من الانتقال للحجز النهائي
 *  ثمّ تظهر رسالةٌ أنه بعيد أو لم يختر منتجاً.»
 *
 * وكان الواقعُ ثلاثةَ عيوب لا واحداً:
 *   ١) «اختر مقاساً واحداً على الأقل» كانت داخل **التأكيد النهائي** — فيملأ
 *      المشتري الورقةَ كلَّها ثمّ يُصدم.
 *   ٢) وحارسُ المسافة كان يسأل عن **أقرب** فرعٍ لا عن **الفرع المختار**:
 *      عرضُ ناصر فيه الخبر على ١٢ كم والباحة مول على ١١٢٩، والمختارُ الثاني
 *      ⇒ الحارسُ يرى ١٢ فيمرّ، والمشتري يحجز من فرعٍ لا يبلغه أبداً.
 *   ٣) وكانت تُقال **واحدةً تلو أخرى**: يُصلح سبباً فيظهر الذي بعده. فتُجمع
 *      الأسبابُ كلُّها في رسالةٍ واحدة — المشتري يرى ما ينقصه دفعةً واحدة.
 *
 * 🪤 ولا تُحجب حالةُ التوصيل بالمسافة: مَن يصله الطلبُ إلى بابه لا يعنيه بُعدُ
 *    الفرع، ونطاقُ التوصيل هو الحاكم هناك (`delivery_quote` في القاعدة).
 * 🔴 **و`deliveryPossible` لا تُعرف عند أوّل ضغطة** (v15.38): سعرُ التوصيل لا
 *    يُطلب إلا بعد فتح الورقة، فالقيمةُ قبلها `false` حتماً. فتُترك غائبةً
 *    هناك — والفحصُ الأوّل فحصُ **استلام** لأن الاستلام هو الوضع الافتراضيّ —
 *    وتُمرَّر صادقةً عند التأكيد حيث يكون الاختيارُ معروفاً.
 *    (وكانت الوحدة تَعِد بإعفاءٍ لا يقع أبداً — ووعدٌ لا يُنفَّذ أسوأ من لا وعد.)
 * 🪤 ونصُّ المهلة **يُمرَّر ولا يُكتب هنا**: قاعدة v14.10 — لا رقمَ ساعاتٍ
 *    مكتوبٌ في نصّ، مصدرُه `utils/bookingHold.ts` وحده.
 * 🪤 والوحدةُ **نقيّة** بلا React: تُختبر بالقيم في `scripts/check-preflight.js`.
 */

/** أبعدُ مسافةٍ يُعقل معها الاستلامُ ضمن مهلة الحجز. */
export const MAX_PICKUP_KM = 100;

export interface PreflightInput {
    isRTL: boolean;
    /** العرضُ له أنواع/مقاسات تُختار */
    hasVariants: boolean;
    /** مجموع القطع المختارة (٠ = لم يختر شيئاً) */
    variantPiecesTotal: number;
    /** مسافة **الفرع المختار** بالكيلومترات — null = موقعُ المشتري غير معروف ⇒ لا حكم */
    selectedKm: number | null;
    selectedName?: string;
    /** أقربُ فرعٍ بديل (للاقتراح حين يكون المختارُ بعيداً) */
    nearestKm?: number | null;
    nearestName?: string;
    /** الأنواعُ وما اختاره المشتري منها وسقفُها في الفرع المختار
     *  (`cap === 0` نفد هنا · `undefined` مفتوحٌ بلا سقف) */
    picks?: Array<{ label: string; sel: number; cap: number | undefined }>;
    /** التوصيل متاحٌ فعلاً لهذا المشتري ⇒ المسافةُ ليست مانعاً.
     *  🪤 تُترك غائبةً قبل فتح الورقة — لا تُعرف هناك. */
    deliveryPossible?: boolean;
    /** للعرض فروعٌ متعدّدة ⇒ يصحّ قولُ «في الفرع المختار». وإلّا فلا فرعَ أصلاً. */
    multiBranch?: boolean;
    /** نصّ مهلة الاستلام جاهزاً («ساعتان» / «two hours») */
    holdText: string;
}

const km = (n: number) => Math.round(n);

/**
 * تُرجع **كلَّ** الأسباب المانعة. مصفوفةٌ فارغة = الطريق سالك.
 * والترتيبُ هو ترتيبُ ما يفعله المشتري: اختر النوع ← صحّح الكمّية ← صحّح الفرع.
 */
export const bookingPreflight = (i: PreflightInput): string[] => {
    const out: string[] = [];
    const ar = i.isRTL;

    const picks = i.picks || [];
    // 🔴 v15.38 — «اضغط + أضف» نصيحةٌ مستحيلة حين تكون كلُّ الأنواع صفراً في
    //    الفرع المختار: لا شيء يُضاف. وهذا يقع فعلاً بعد اختيار فرعٍ نفد فيه
    //    كلُّ شيء — فالرسالةُ تقول ما يُفعل حقاً: بدّل الفرع.
    const everyPickOut = picks.length > 0 && picks.every(p => p.cap === 0);
    if (i.hasVariants && i.variantPiecesTotal <= 0) {
        out.push(everyPickOut
            ? (ar
                ? `⛔ كل الأنواع نفدت${i.multiBranch ? ' في الفرع المختار' : ''} — ${i.multiBranch ? 'اختر فرعاً آخر من قائمة المواقع أعلاه.' : 'لا يمكن الحجز الآن.'}`
                : `⛔ Every variant is sold out${i.multiBranch ? ' at the selected branch' : ''} — ${i.multiBranch ? 'pick another branch above.' : 'booking is not possible right now.'}`)
            : (ar
                ? '🧬 لم تختر الحجم أو النوع — اضغط «+ أضف» على ما تريده من القائمة أعلاه.'
                : '🧬 No size/variant selected — tap “+ Add” on the one you want above.'));
    }

    const where = i.multiBranch ? (ar ? ' في الفرع المختار' : ' at the selected branch') : '';
    const chosen = picks.filter(p => p.sel > 0);
    const soldOut = chosen.find(p => p.cap === 0);
    if (soldOut) {
        out.push(ar
            ? `⛔ «${soldOut.label}» غير متوفر${where} — اختر نوعاً آخر${i.multiBranch ? ' أو فرعاً آخر' : ''}.`
            : `⛔ “${soldOut.label}” is unavailable${where} — pick another variant${i.multiBranch ? ' or branch' : ''}.`);
    }

    const over = chosen.find(p => typeof p.cap === 'number' && p.cap > 0 && p.sel > p.cap);
    if (over) {
        out.push(ar
            ? `⛔ المتاح من «${over.label}»${where} ${over.cap} فقط — خفّف الكمية.`
            : `⛔ Only ${over.cap} of “${over.label}” left${where} — reduce the quantity.`);
    }

    // المسافة: الفرعُ **المختار** هو الذي سيستلم منه، لا الأقرب.
    if (!i.deliveryPossible && i.selectedKm != null && i.selectedKm > MAX_PICKUP_KM) {
        const nearerIsUsable = i.nearestKm != null && i.nearestKm <= MAX_PICKUP_KM && i.nearestName
            && i.nearestName !== i.selectedName;
        out.push(nearerIsUsable
            ? (ar
                ? `📍 الفرع المختار${i.selectedName ? ` «${i.selectedName}»` : ''} يبعد عنك ${km(i.selectedKm)} كم، ومهلة الاستلام ${i.holdText} فقط.\nاختر «${i.nearestName}» (${km(i.nearestKm as number)} كم) من قائمة المواقع أعلاه.`
                : `📍 The selected branch${i.selectedName ? ` “${i.selectedName}”` : ''} is ${km(i.selectedKm)} km away and the pickup window is only ${i.holdText}.\nPick “${i.nearestName}” (${km(i.nearestKm as number)} km) from the branch list above.`)
            : (ar
                ? `⛔ أقرب فرع لهذا العرض يبعد عنك ${km(i.selectedKm)} كم (أكثر من ${MAX_PICKUP_KM} كم)، ومهلة الاستلام ${i.holdText} فقط — فلن تصل خلالها ويُلغى الحجز تلقائياً. ابحث عن عرض أقرب لك.`
                : `⛔ The nearest branch is ${km(i.selectedKm)} km away (over ${MAX_PICKUP_KM} km) and the pickup window is only ${i.holdText} — the booking would auto-cancel. Please pick a closer deal.`));
    }

    return out;
};

/** رسالةٌ واحدة من كلّ الأسباب — مرقّمةٌ حين تتعدّد فلا تلتبس. */
export const preflightMessage = (reasons: string[], isRTL: boolean): string => {
    if (!reasons.length) return '';
    if (reasons.length === 1) return reasons[0];
    const head = isRTL ? 'قبل الحجز، صحّح ما يلي:' : 'Before booking, fix the following:';
    return `${head}\n\n${reasons.map((r, n) => `${n + 1}) ${r}`).join('\n\n')}`;
};

/**
 * سببُ تعذّر التوصيل — جملةٌ واحدة تقول ما يفعله المشتري الآن.
 * نُقلت من `DealDetails` في v15.36: سلسلةُ شروطٍ متداخلةٍ من أربعةٍ وعشرين
 * سطراً مكانُها مع أخواتها من الرسائل، لا في وسط مكوّنٍ يرسم صفحة.
 * `null` = لا مانع (أو المتجرُ لا يوصّل أصلاً فلا شيء يُقال).
 */
export const deliveryBlockReason = (i: {
    isRTL: boolean; on: boolean; hasAddress: boolean; loading: boolean;
    available: boolean; reason?: string; gateReady: boolean; belowMin: boolean;
    minOrder: number; total: number;
}): string | null => {
    const ar = i.isRTL;
    if (!i.on) return null;
    if (!i.hasAddress) return ar
        ? '📍 أضِف عنوان التوصيل في «حسابي ← الإعدادات» ليظهر لك خيار التوصيل.'
        : '📍 Add your delivery address in “My account → Settings” to unlock delivery.';
    if (i.loading) return ar ? '⏳ جاري التحقق من نطاق التوصيل لهذا الفرع…' : '⏳ Checking this branch’s delivery area…';
    if (!i.available) {
        // 🪤 `no_zones` ≠ `out_of_zone`: الأول يعني أن هذا الفرع لم يرسم نطاقاً
        // أصلاً، فنصيحة «اختر عنواناً آخر» فيه عبثٌ يُتعب المشتري.
        if (i.reason === 'no_zones') return ar
            ? '🚫 هذا الفرع لم يحدّد نطاق توصيل بعد — جرّب فرعاً آخر، والاستلام من المتجر متاح.'
            : '🚫 This branch has no delivery area yet — try another branch; pickup is available.';
        return ar
            ? '🚫 هذا العنوان خارج نطاق توصيل الفرع المختار — اختر عنواناً آخر أو فرعاً أقرب، والاستلام من المتجر متاح.'
            : '🚫 This address is outside the selected branch’s delivery area — pick another address or branch; pickup is available.';
    }
    if (!i.gateReady) return ar
        ? '💳 هذا المتجر يوصّل بالبطاقة فقط ولم يُفعّل بوابة الدفع بعد — التوصيل غير متاح حالياً.'
        : '💳 This store delivers card-only but has no active payment gateway yet — delivery is unavailable.';
    if (i.belowMin) {
        const add = Math.round((i.minOrder - i.total) * 100) / 100;
        return ar
            ? `🚚 الحد الأدنى لطلب التوصيل ${i.minOrder} ر.س — أضِف ${add} ر.س ليصبح التوصيل متاحاً.`
            : `🚚 Delivery minimum is ${i.minOrder} SAR — add ${add} SAR to unlock it.`;
    }
    return null;
};
