/**
 * locationQty — صفرٌ كمّيةٌ صالحة، وإسقاطُ الموقع بلا كمّية (v15.33)
 *
 * ── العيب الذي يسدّه (بلاغ ناصر) ───────────────────────────────────────────
 * تاجرٌ له نوعان (كبير/صغير) وموقعان (الجوف/الخرج) أراد: كبير ٢٤ في الجوف
 * و**صفر** في الخرج. فكتب صفراً، فاحمرّ الحقل، ورُفض الحفظ بإنذارٍ لا مخرج
 * منه؛ ولو حذف السطرَ صار الخرجُ «مفتوحاً بلا حدّ» — أي عكسَ قصده تماماً.
 *
 * والسببُ أن الكودَ كان يسأل في عشرة مواضع `Number(q) > 0`، فيصير «صفر»
 * و«فارغ» شيئاً واحداً. وهما ليسا كذلك:
 *   • `undefined` = لم يُحدَّد  ⇒ الموقعُ مفتوحٌ بلا سقف.
 *   • `0`         = رقمٌ حقيقيّ ⇒ الموقعُ مسقوفٌ على صفر («لا يوجد هنا»).
 * والقاعدةُ تفرّق بينهما أصلاً: حارسُ المخزون يقرأ **وجودَ المفتاح**
 * (`e ? 'variantQtys'`) لا قيمته، فخليّةٌ بصفرٍ تُرفض عندها بـP0010.
 * فالعيبُ كان في الواجهة وحدها، وهي التي كانت تُسقط الصفر قبل أن يصل.
 *
 * 🪤 ولا تُستعمل `Number(q) >= 0` وحدها: `Number(undefined)` = NaN فتمرّ،
 *    و`Number('')` و`Number(null)` = **صفر** فتُحوّلان الفراغ إلى صفر.
 *
 * 🔴 **والطريقُ ذهابٌ وإياب (v15.34).** سُدّ مسارُ الحفظ في v15.33 وبقي مسارُ
 *    **القراءة**: `SellerDashboard` كان يُعيد بناء المجموعات من العرض المحفوظ
 *    بشرط `qv > 0`، فيُسقط كلَّ خليّةٍ بصفر. فتكتب «٠ في الخرج» فيُحفظ، ثمّ
 *    تفتح العرضَ للتعديل فيعود الفرعُ «مفتوحاً بلا حدّ»، والحفظُ التالي
 *    **يبيع ما لا يملكه التاجر** — بلا خطأ ولا أثرٍ على الشاشة.
 *    ⇒ كلُّ قيمةٍ تُكتب وتُقرأ تُفحص في **الاتجاهين**، لا في اتجاه الكتابة وحده.
 */

/** هل أعطى التاجر رقماً فعلاً؟ الصفرُ نعم، والفراغُ لا. */
export const qtyGiven = (q: unknown): boolean =>
    q !== undefined && q !== null && q !== '' && Number.isFinite(Number(q)) && Number(q) >= 0;

export const qtyNum = (q: unknown): number => (qtyGiven(q) ? Number(q) : 0);

export interface DropPlan {
    /** مفاتيح المواقع المقترح حذفها (لا مجموعةَ لها إطلاقاً) */
    dropKeys: string[];
    /** أسماؤها كما يراها التاجر */
    names: string[];
    /** الكمّية العامّة بعد الإسقاط حين يبقى الموقعُ الأساسيّ وحده (بلا أنواع) */
    qtyOverride?: number;
    /** كمّية كل نوع بعد الإسقاط حين يبقى الأساسيّ وحده */
    varQtyOverride: Record<string, number>;
}

/**
 * قاعدة ناصر (ج): «موقعان وكمّيةٌ واحدة ⇒ يُلغى تحديدُ الموقع الثاني،
 * فتكون النتيجة موقعاً واحداً وكمّيةً واحدة.»
 *
 * تُرجع `null` حين لا يكون المخرجُ واضحاً بلا لبس، فيبقى الإنذارُ القديم:
 *   • موقعٌ **نصفَ** مملوء (بعض أنواعه بكمّية وبعضها لا) — فيه رقمٌ حقيقيّ
 *     فلا يُحذف تخميناً، ويُطلب إكمالُه.
 *   • الموقعُ الأساسيّ بلا كمّية — لا يُحذف أبداً، فهو موقعُ العرض نفسه.
 *   • لم يبقَ موقعٌ واحدٌ بكمّية — فلا شيء يُحفظ أصلاً.
 *
 * 🪤 وموقعٌ كُتب فيه **صفر** يُعدّ مملوءاً (`full`) فلا يُقترح حذفُه —
 *    الصفرُ قرارُ التاجر: «أبقِه ظاهراً وقل إنه نفد هنا».
 */
export const planLocationDrop = (args: {
    extras: Array<{ key: string; label: string }>;
    variantIds: string[];
    cell: (variantId: string, branchKey: string) => number | undefined;
}): DropPlan | null => {
    const { extras, variantIds, cell } = args;
    if (!extras.length) return null;

    const covOf = (k: string): 'full' | 'none' | 'partial' => {
        if (!variantIds.length) return cell('__base__', k) !== undefined ? 'full' : 'none';
        const n = variantIds.filter(vId => cell(vId, k) !== undefined).length;
        return n === variantIds.length ? 'full' : (n === 0 ? 'none' : 'partial');
    };

    const allKeys = ['primary', ...extras.map(c => c.key)];
    if (allKeys.some(k => covOf(k) === 'partial')) return null;
    if (covOf('primary') !== 'full') return null;

    const empty = extras.filter(c => covOf(c.key) === 'none');
    if (!empty.length) return null;
    const kept = allKeys.filter(k => covOf(k) === 'full');
    if (!kept.length) return null;

    const plan: DropPlan = { dropKeys: empty.map(c => c.key), names: empty.map(c => c.label), varQtyOverride: {} };

    // لو لم يبقَ إلا الأساسيّ صار العرضُ أحاديَّ الموقع، فكمّيتُه هي كمّيةُ
    // مجموعته — وإلا ضاع ما كتبه التاجر وطُولب به مرّةً ثانية.
    if (extras.every(c => plan.dropKeys.includes(c.key))) {
        if (!variantIds.length) {
            const c = cell('__base__', 'primary');
            if (c !== undefined) plan.qtyOverride = c;
        } else {
            variantIds.forEach(vId => { const c = cell(vId, 'primary'); if (c !== undefined) plan.varQtyOverride[vId] = c; });
        }
    }
    return plan;
};

/**
 * هل في هذا الفرع شيءٌ يُباع؟ (v15.34)
 *
 * صارت الكمّية صفراً **قيمةً صالحة** («لا يوجد في هذا الفرع»)، فاختيارُ
 * الفرع الأقرب وحده صار يفتح صفحةَ العرض على فرعٍ كلُّ أنواعه رمادية —
 * فيبدو المنتجُ نافداً وهو متوفّرٌ في الفرع المجاور.
 * 🪤 ولا يُحجب الفرعُ النافد: إن نفدت الفروعُ كلُّها يُختار الأقرب كما كان،
 *    فلا تُفتح الصفحةُ بلا فرعٍ أصلاً.
 * 🪤 والخانةُ **الغائبة** مفتوحةٌ بلا سقف ⇒ فيها شيء. فلا يُسأل «> 0» بل
 *    «ليست صفراً» — وهي نفسُ قاعدة [[qtyGiven]] من الجهة الأخرى.
 */
export const branchHasStock = (l: { quantity?: number; variantQtys?: Record<string, number> }): boolean => {
    const vq = l.variantQtys;
    if (vq && Object.keys(vq).length) return Object.values(vq).some(n => Number(n) !== 0);
    return Number(l.quantity) !== 0;
};

export const dropAskText = (names: string[], isRTL: boolean): string => {
    const n = names.join(isRTL ? '، ' : ', ');
    return isRTL
        ? `📍 ${n}: لم تضع له كمّية.\n\nأحذفه من هذا العرض وأحفظ الباقي؟\n(ولو أردت إبقاءه وإظهاره «نفد» فاكتب له صفراً بدل الحذف.)`
        : `📍 ${n}: no quantity set.\n\nRemove it from this deal and save the rest?\n(To keep it and show it sold out, enter 0 instead.)`;
};

/**
 * كلُّ المواقع بصفر مع الانتهاء «بالكمّية». v15.34 — كانت تسقط في الرسالة
 * العامّة «يرجى تحديد الكمية المتوفرة» وقد حدّدها التاجرُ كلَّها، فتبدو
 * المنصّةُ لا تقرأ ما كُتب. والرفضُ صحيحٌ (لا شيء يُباع) والسببُ وحده كان كاذباً.
 */
export const allZeroText = (isRTL: boolean): string => isRTL
    ? '⚠️ كتبت صفراً في كل المواقع — فلا شيء يُباع. اكتب كمية في موقع واحد على الأقل، أو غيّر نظام الانتهاء إلى الساعات/الأيام/التاريخ.'
    : '⚠️ Every branch is zero — nothing to sell. Give at least one branch a quantity, or switch expiry to hours/days/date.';

export const dropKeepText = (isRTL: boolean): string => isRTL
    ? '👍 لم يُحذف شيء. اكتب كمّية لكلّ موقع — والصفر مقبول ويعني «لا يوجد هنا».'
    : '👍 Nothing removed. Give every branch a quantity — 0 is accepted and means “none here”.';
