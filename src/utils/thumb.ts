/**
 * thumb.ts — النسخة المصغّرة من صور المنتجات (v13.32)
 *
 * كل صورة تُرفع منذ v13.32 لها توأم مصغّر `<الاسم>_t.jpg` بجوارها (٦٠٠ بكسل،
 * ~٤٠–٦٠ كيلوبايت بدل ~٢٠٠). البطاقات والقوائم تعرض المصغّرة، وصفحة المنتج
 * وعارض التكبير يبقيان على الأصل كامل الجودة.
 *
 * الصور المرفوعة قبل هذا الإصدار لا مصغّرة لها — لذلك القاعدة هنا:
 * **لا نُغيّر رابطاً إلا إذا كنا نعرف أن المصغّرة موجودة**، والمكوّن يستخدم
 * `onThumbError` ليرتدّ للأصل لو أعطى الرابط ٤٠٤. النتيجة: لا صورة مكسورة
 * أبداً — أسوأ حالة أن الصورة القديمة تُحمَّل كما كانت تماماً.
 */

// روابط تخزين Supabase فقط (لا نلمس روابط خارجية مثل unsplash/picsum).
const SUPABASE_DEAL_IMAGE = /\/storage\/v1\/object\/public\/deals\/([^/?#]+)\.(jpe?g|png|webp)(\?.*)?$/i;

/** رابط النسخة المصغّرة، أو الرابط نفسه إن لم يكن من تخزين المنتجات. */
export const thumbUrl = (url?: string | null): string => {
    const u = String(url || '');
    if (!u) return '';
    const m = u.match(SUPABASE_DEAL_IMAGE);
    if (!m) return u;                       // رابط خارجي أو بصيغة غير متوقعة
    if (/_t$/i.test(m[1])) return u;        // مصغّرة أصلاً
    return u.replace(SUPABASE_DEAL_IMAGE, `/storage/v1/object/public/deals/${m[1]}_t.jpg${m[3] || ''}`);
};

/** الصورة البديلة الافتراضية حين يفشل الأصل نفسه. */
export const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=600';

/**
 * معالج `onError` بارتداد من خطوتين — يُمرَّر لكل <img> يعرض مصغّرة:
 *   المصغّرة غير موجودة (صورة ما قبل v13.32) → الأصل كامل الجودة
 *   الأصل نفسه مكسور (حُذف من التخزين)      → الصورة البديلة
 * كل خطوة تُنفَّذ مرة واحدة (علامة على العنصر) فلا تنشأ حلقة لا نهائية.
 */
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
