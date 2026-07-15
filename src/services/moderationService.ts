/**
 * moderationService v12.31 — NSFW image screening (Nasser #13).
 *
 * أقوى خيار مجاني غير محدود: نموذج NSFWJS (MobileNetV2 مضغوط ~2.7MB) يعمل
 * بالكامل داخل متصفح المستخدم عبر TensorFlow.js — لا مفاتيح API، لا حدود
 * استخدام، ولا تُرسل الصورة لأي طرف ثالث (خصوصية كاملة). النموذج مستضاف
 * ذاتياً في /models/nsfw (نفس النطاق — لا CSP ولا خدمة خارجية قد تسقط).
 * نشغّل النموذج مباشرة بـtfjs بدون مكتبة nsfwjs الوسيطة — نسخها الحديثة
 * تضمّن نماذجها داخل الحزمة فتضخّم البناء بعشرات الميغابايت بلا داعٍ؛
 * التصنيف نفسه ثلاثة أسطر: fromPixels → resize 224 → predict.
 *
 * التصميم «لا يخرّب الموقع» عمداً:
 *  - تحميل كسول: tfjs (+النموذج) لا تُحمَّل إلا عند أول رفع صورة —
 *    حزمة منفصلة (dynamic import) فلا تؤثر على سرعة فتح التطبيق إطلاقاً.
 *  - Fail-open: أي فشل (شبكة/ذاكرة/متصفح قديم/مهلة 12ث) = تمرير الصورة
 *    بشكل طبيعي مع تحذير في الكونسول — الفلتر لا يمنع البيع أبداً بالخطأ.
 *  - عند الحظر: تُسجَّل محاولة الرفع في moderation_flags (تبويب «الإنذارات»)
 *    عبر RPC log_moderation_flag، فيرى ناصر من حاول رفع ماذا ومتى.
 *
 * العتبات (المعيار المتعارف عليه لنموذج NSFWJS):
 *   Porn ≥ 0.55 أو Hentai ≥ 0.55 أو Sexy ≥ 0.80 → حظر.
 */

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

export interface ImageVerdict {
    ok: boolean;
    label?: string;      // التصنيف الحاسم عند الحظر (Porn/Hentai/Sexy)
    score?: number;      // احتماله 0..1
}

const THRESHOLDS: Record<string, number> = { Porn: 0.55, Hentai: 0.55, Sexy: 0.8 };
// ترتيب مخرجات النموذج ثابت (أبجدي — نفس ترتيب NSFWJS الرسمي).
const CLASSES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as const;
const INPUT_SIZE = 224;
const CHECK_TIMEOUT_MS = 12000;

// tfjs + النموذج يُحمَّلان مرة واحدة ويُعاد استخدامهما لكل الصور التالية.
let modelPromise: Promise<{ tf: any; model: any }> | null = null;
const loadModel = () => {
    if (!modelPromise) {
        modelPromise = (async () => {
            const tf = await import('@tensorflow/tfjs');
            const model = await tf.loadLayersModel('/models/nsfw/model.json');
            return { tf, model };
        })();
        // فشل التحميل لا يعلّق الجلسة على promise مرفوض للأبد — نسمح بمحاولة
        // جديدة في الرفع التالي (قد يكون انقطاع شبكة مؤقتاً).
        modelPromise.catch(() => { modelPromise = null; });
    }
    return modelPromise;
};

const fileToImage = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
        img.src = url;
    });

export const moderationService = {
    /**
     * يفحص صورة قبل رفعها. `{ok:true}` = مسموحة (أو تعذّر الفحص — fail-open)،
     * `{ok:false,label,score}` = محتوى غير لائق مرفوض.
     */
    checkImage: async (file: File): Promise<ImageVerdict> => {
        try {
            if (!file.type.startsWith('image/')) return { ok: true };
            const timeout = new Promise<ImageVerdict>(resolve =>
                setTimeout(() => resolve({ ok: true }), CHECK_TIMEOUT_MS));
            const scan = (async (): Promise<ImageVerdict> => {
                const { tf, model } = await loadModel();
                const img = await fileToImage(file);
                try {
                    // نفس معالجة NSFWJS الرسمية: بكسلات → 0..1 → resize 224
                    // (alignCorners) → دفعة واحدة → predict. tidy يمنع تسرب الذاكرة.
                    const logits = tf.tidy(() => {
                        const pixels = tf.browser.fromPixels(img).toFloat().div(tf.scalar(255));
                        const resized = tf.image.resizeBilinear(pixels, [INPUT_SIZE, INPUT_SIZE], true);
                        return model.predict(resized.reshape([1, INPUT_SIZE, INPUT_SIZE, 3]));
                    });
                    const scores = await logits.data();
                    logits.dispose();
                    for (let i = 0; i < CLASSES.length; i++) {
                        const limit = THRESHOLDS[CLASSES[i]];
                        if (limit !== undefined && scores[i] >= limit) {
                            return { ok: false, label: CLASSES[i], score: scores[i] };
                        }
                    }
                    return { ok: true };
                } finally {
                    URL.revokeObjectURL(img.src);
                }
            })();
            return await Promise.race([scan, timeout]);
        } catch (e: any) {
            // فحص الصور يجب ألا يعطّل الرفع أبداً — نمرر ونحذّر فقط.
            logger.warn('NSFW check skipped (fail-open):', e?.message || e);
            return { ok: true };
        }
    },

    /** يسجّل محاولة رفع محظورة في تبويب «الإنذارات» (fire-and-forget). */
    reportBlockedUpload: (fileName: string, verdict: ImageVerdict): void => {
        const pct = Math.round((verdict.score || 0) * 100);
        supabase.rpc('log_moderation_flag', {
            p_source: 'upload',
            p_content: `🚫 صورة مرفوضة قبل الرفع — تصنيف ${verdict.label} بنسبة ${pct}٪ (${fileName})`,
            p_matched: verdict.label ? [verdict.label] : null,
        }).then(({ error }) => {
            if (error) logger.warn('log_moderation_flag failed:', error.message);
        });
    },
};
