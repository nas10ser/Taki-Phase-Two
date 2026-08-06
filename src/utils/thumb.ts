/**
 * thumb.ts — النسخة المصغّرة من صور المنتجات (v13.32، أُعيد بناء منطقها في v13.71)
 *
 * كل صورة تُرفع منذ v13.32 لها توأم مصغّر `<الاسم>_t.jpg` بجوارها (٦٠٠ بكسل،
 * ~٤٠–٦٠ كيلوبايت بدل ~٢٠٠). البطاقات والقوائم تعرض المصغّرة، وصفحة المنتج
 * وعارض التكبير يبقيان على الأصل كامل الجودة.
 *
 * ⚠️ الدرس المكلف (v13.71): النسخة الأولى كانت **تخمّن** — تحوّل رابط أي صورة
 * في مستودع المنتجات إلى `_t.jpg` وتعتمد على `onError` للارتداد. وقياس القاعدة
 * أظهر أن **١٧٢ من ١٧٣ صورة بلا مصغّرة إطلاقاً** (لم يُرفع سوى صورة واحدة بعد
 * v13.32)، أي أن كل صورة في التطبيق كانت تطلب ملفاً غير موجود أولاً، تنتظر
 * ٤٠٤، ثم تبدّل المصدر وتبدأ تحميل الأصل من الصفر. النتيجة التي رآها ناصر:
 * بطاقة تُرسم **بلا صورة** للحظة (أو لثوانٍ على شبكة بطيئة) — «الصور الناقصة».
 *
 * القاعدة الآن: **لا نطلب مصغّرة إلا إذا كنّا نعرف يقيناً أنها موجودة.**
 * والمعرفة تُحمل في الرابط نفسه: كل صورة تُرفع ومعها مصغّرتها بنجاح تُخزَّن
 * بعلامة `?t=1` (انظر storageService.uploadImage و ImageOptimizer). فالصور
 * القديمة تُحمَّل مباشرة بلا أي طلب فاشل، والجديدة تستفيد من المصغّرة كاملةً.
 * ويبقى `imgFallback` شبكة أمان أخيرة لا خطة أساسية.
 */

// روابط تخزين Supabase فقط (لا نلمس روابط خارجية مثل unsplash/picsum).
const SUPABASE_DEAL_IMAGE = /\/storage\/v1\/object\/public\/deals\/([^/?#]+)\.(jpe?g|png|webp)(\?.*)?$/i;

/** علامة «لهذه الصورة مصغّرة مرفوعة ومؤكَّدة» — تُكتب في الرابط لحظة الرفع. */
export const THUMB_MARK = 't=1';

/** يضيف علامة المصغّرة لرابط رُفعت مصغّرته بنجاح. */
export const markThumbed = (url: string): string => {
    const u = String(url || '');
    if (!u || hasThumb(u)) return u;
    return u + (u.includes('?') ? '&' : '?') + THUMB_MARK;
};

/** هل يحمل الرابط علامة وجود مصغّرة؟ */
export const hasThumb = (url?: string | null): boolean => {
    const u = String(url || '');
    if (!u.includes('?')) return false;
    return u.slice(u.indexOf('?') + 1).split(/[&;]/).includes(THUMB_MARK);
};

/**
 * رابط النسخة المصغّرة — أو الرابط نفسه إن لم تكن هناك مصغّرة مؤكَّدة.
 * لا يطلب هذا الدالّ أبداً ملفاً لا نعرف وجوده.
 */
export const thumbUrl = (url?: string | null): string => {
    const u = String(url || '');
    if (!u) return '';
    if (!hasThumb(u)) return u;             // صورة قديمة أو خارجية → الأصل مباشرة
    const m = u.match(SUPABASE_DEAL_IMAGE);
    if (!m) return u;                       // رابط خارجي أو بصيغة غير متوقعة
    if (/_t$/i.test(m[1])) return u;        // مصغّرة أصلاً
    return u.replace(SUPABASE_DEAL_IMAGE, `/storage/v1/object/public/deals/${m[1]}_t.jpg${m[3] || ''}`);
};

/** الصورة البديلة الافتراضية حين يفشل الأصل نفسه. */
export const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=600';

/**
 * معالج `onError` بارتداد من خطوتين — يُمرَّر لكل <img> يعرض مصغّرة:
 *   المصغّرة مفقودة رغم العلامة (رفع فاشل نادر) → الأصل كامل الجودة
 *   الأصل نفسه مكسور (حُذف من التخزين)          → الصورة البديلة
 * كل خطوة تُنفَّذ مرة واحدة (علامة على العنصر) فلا تنشأ حلقة لا نهائية.
 */
/**
 * `onError` لصور لا بديل لها (شعار متجر مثلاً): تُخفى الصورة فيظهر ما تحتها
 * (حرف الاسم أو الإيموجي) بدل مربّع مكسور أو نصّ بديل معلّق. v13.71
 */
export const hideBrokenImg = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    e.currentTarget.style.display = 'none';
};

export const imgFallback = (original?: string | null, placeholder: string = FALLBACK_IMAGE) =>
    (e: React.SyntheticEvent<HTMLImageElement>): void => {
        const img = e.currentTarget;
        const full = String(original || '');
        if (full && img.dataset.imgStep !== 'full' && img.dataset.imgStep !== 'placeholder' && img.src !== full) {
            img.dataset.imgStep = 'full';
            img.src = full;
            return;
        }
        if (img.dataset.imgStep === 'placeholder') return;
        img.dataset.imgStep = 'placeholder';
        img.src = placeholder;
    };
