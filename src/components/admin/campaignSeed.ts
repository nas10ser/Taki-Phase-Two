/**
 * campaignSeed — شكلُ مسودّة الحملة الترويجية وبذرُها من صفّ القاعدة (v16.36)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي وُلد هذا الملفّ لأجله (بلاغُ ناصر بلقطة، ١٧ نوفمبر ٢٠٢٦):
 *    فتحُ **تعديل** حملةٍ قائمة ثمّ الضغط على «حفظ التعديلات» كان يرمي
 *        `null is not an object (evaluating 'b.image_url.trim')`
 *    فلا تُحفظ الحملةُ أبداً — ورسالةٌ إنجليزيّةٌ خامّ في وجه المستخدم.
 *
 *    والسببُ أن البذرَ كان نشراً أعمى: `{ ...emptyCampaign, ...(initial) }`.
 *    والنشرُ الثاني ينسخ كلَّ أعمدة الصفّ كما هي، ومنها ما يقبل `null` في
 *    القاعدة — فيدهس `''` بـ`null`، ثمّ تنفجر `.trim()` عليه عند الحفظ.
 *
 * 🪤 **والعلاجُ على الصنف لا على العمود الذي ظهر في الرسالة.** أربعةُ أعمدةٍ
 *    نصّيّةٍ كانت مكشوفةً لا واحد:
 *        `image_url` · `action_url` · `action_label_ar` · `action_label_en`
 *    و`image_url` أوّلُها في ترتيب بناء الصفّ عند الحفظ، فهو الذي صرخ؛ ولو
 *    حُمي وحده لانفجر الذي يليه عند أوّل حملةٍ بلا زرّ إجراء.
 *
 * 🪤 **ويُمَرّ على مفاتيح النموذج لا على مفاتيح الصفّ.** صفُّ القاعدة يحمل
 *    أعمدةً لا تخصّ النموذج (`id` · `created_at` · `last_broadcast_at` …)
 *    وكانت تتسرّب إلى الحالة ثمّ تُرسَل ضمن `update` — أي كتابةُ أعمدةٍ لم
 *    يطلب أحدٌ تغييرَها. فالمرورُ على `emptyCampaign` يسدّ البابين معاً.
 *
 * وهذا الملفّ **خالصٌ بلا استيراد** عمداً: يُترجَم ويُشغَّل كما هو في
 * `scripts/test-campaign-seed.js`، فالفحصُ تنفيذٌ حقيقيٌّ لا قراءةُ نصّ.
 */

export type CampaignDraft = {
    title_ar: string; title_en: string; body_ar: string; body_en: string;
    target_audience: 'all' | 'buyer' | 'seller';
    target_city: string; target_region: string;
    image_url: string; action_url: string;
    action_label_ar: string; action_label_en: string;
    starts_at: string; ends_at: string;
    priority: number; is_active: boolean;
    /** v12.27 — إعادة بث تلقائية: none/daily/every_3_days/weekend/weekly/monthly */
    recurrence: string;
    /** ساعة الإرسال بتوقيت الرياض (0–23) */
    recurrence_hour: number;
};

export const emptyCampaign: CampaignDraft = {
    title_ar: '', title_en: '', body_ar: '', body_en: '',
    target_audience: 'all', target_city: '', target_region: '',
    image_url: '', action_url: '', action_label_ar: '', action_label_en: '',
    starts_at: '', ends_at: '', priority: 0, is_active: true,
    recurrence: 'none', recurrence_hour: 10,
};

/**
 * يبني مسودّةً كاملةً من صفّ قاعدةٍ قد يحمل `null` في أيّ عمودٍ اختياريّ.
 * القاعدة: لا يدخل النموذجَ إلّا مفتاحٌ من `emptyCampaign`، ولا تُؤخذ قيمتُه
 * إلّا إن كانت موجودةً فعلاً — وإلّا بقي الافتراضُ الآمن.
 */
export const seedCampaign = (src: unknown): CampaignDraft => {
    const row = (src ?? {}) as Record<string, unknown>;
    const out = { ...emptyCampaign };
    for (const k of Object.keys(emptyCampaign) as (keyof CampaignDraft)[]) {
        const v = row[k];
        if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
    return out;
};
