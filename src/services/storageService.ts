import { CONFIG } from '../config';
import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';
import { compressImage, THUMB } from '../utils/imageCompression';
import { markThumbed } from '../utils/thumb';

/**
 * سقف الرفع وصيغه — v14.71.
 * ٤ ميجابايت هو سقف مستودع `deals` على الخادم نفسه، فالفحص هنا يمنع رحلةً
 * فاشلة ويقول السبب بدل خطأٍ عامّ من القاعدة. والصيغ هي ما تقبله سياسة
 * الكتابة فعلاً (فُحصت على جدة) — لا ما يقبله المستودع وحده.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const OK_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export const storageService = {
    /**
     * v12.31 — سبب رفض آخر رفع (null = لا رفض). تقرؤه نقاط الاستدعاء لعرض
     * رسالة «محتوى غير لائق» بدل «فشل الرفع» العامة عندما يحجب فلتر الصور
     * الإباحية (moderationService) الصورة.
     */
    lastBlockReason: null as 'nsfw' | 'too_big' | 'bad_type' | null,

    get: <T>(key: keyof typeof CONFIG.STORAGE_KEYS): T | null => {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEYS[key]);
        if (!stored) return null;
        try {
            return JSON.parse(stored) as T;
        } catch {
            return null;
        }
    },

    set: <T>(key: keyof typeof CONFIG.STORAGE_KEYS, value: T): void => {
        localStorage.setItem(CONFIG.STORAGE_KEYS[key], JSON.stringify(value));
    },

    remove: (key: keyof typeof CONFIG.STORAGE_KEYS): void => {
        localStorage.removeItem(CONFIG.STORAGE_KEYS[key]);
    },

    // Sensitive Data Handling (Obfuscation as a placeholder for real Encryption)
    getSecure: <T>(key: keyof typeof CONFIG.STORAGE_KEYS): T | null => {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEYS[key]);
        if (!stored) return null;
        try {
            const decoded = atob(stored);
            return JSON.parse(decoded) as T;
        } catch {
            return null;
        }
    },

    setSecure: <T>(key: keyof typeof CONFIG.STORAGE_KEYS, value: T): void => {
        const encoded = btoa(JSON.stringify(value));
        localStorage.setItem(CONFIG.STORAGE_KEYS[key], encoded);
    },

    clear: (): void => {
        localStorage.clear();
    },

    /**
     * v13.33 — لكل نوع صورة مقاسه (طلب ناصر: «والبنرات لا تنساها»):
     *   • منتج  (الافتراضي) — كاملة ١٤٠٠ + مصغّرة ٦٠٠ للبطاقات
     *   • بنر   `BANNER`    — عريض بلا مصغّرة (لا يُعرض صغيراً أبداً)
     *   • شعار متجر `AVATAR` — يُعرض بقطر ٦٤ نقطة فقط، فـ٤٠٠ بكسل تكفيه بسخاء
     * كان الجميع يُرفع بمقاس المنتج نفسه، فشعار المتجر (دائرة ٦٤ نقطة) كان
     * يُنزَّل بحجم صورة منتج كاملة على كل فتح للصفحة.
     */
    uploadImage: async (
        rawFile: File,
        opts?: { compress?: Partial<{ maxDim: number; quality: number; skipUnderBytes: number }>; thumb?: boolean },
    ): Promise<string | null> => {
        try {
            storageService.lastBlockReason = null;
            // 🪤 v14.71 — فحصُ الحجم والصيغة **قبل** كل شيء. لم يكن هنا أيّ فحص:
            // `accept="image/*"` على حقل الملف تلميحٌ للمتصفّح لا قيد، والضاغط
            // fail-open بالتصميم (`catch { return file }`) فصورة HEIC لا يفكّها
            // المتصفّح تُرفع **خاماً**، فيرفضها سقف المستودع (٤ ميجابايت) بخطأ
            // عامّ ⇒ `null` ⇒ ورسالةُ فشلٍ لا تقول السبب. (`chatAttachments`
            // كانت تفعل الصواب منذ v14.27 — هذا هو نفس النمط، لا نمطٌ ثانٍ.)
            if (rawFile.size > MAX_UPLOAD_BYTES) {
                storageService.lastBlockReason = 'too_big';
                logger.warn(`🚫 upload rejected: ${Math.round(rawFile.size / 1024 / 1024)}MB > 4MB`);
                return null;
            }
            if (rawFile.type && !OK_IMAGE_TYPES.includes(rawFile.type)) {
                storageService.lastBlockReason = 'bad_type';
                logger.warn(`🚫 upload rejected: نوع غير مدعوم ${rawFile.type}`);
                return null;
            }
            // v12.31 — فحص الصور الإباحية قبل الرفع (NSFWJS داخل المتصفح).
            // نقطة اختناق واحدة = كل مسارات الرفع (منتجات/بنرات/مسابقات)
            // مفحوصة تلقائياً. الفحص fail-open فلا يعطّل الرفع أبداً.
            try {
                const { moderationService } = await import('./moderationService');
                const verdict = await moderationService.checkImage(rawFile);
                if (!verdict.ok) {
                    storageService.lastBlockReason = 'nsfw';
                    moderationService.reportBlockedUpload(rawFile.name, verdict);
                    logger.warn(`🚫 upload blocked by NSFW filter: ${verdict.label} ${Math.round((verdict.score || 0) * 100)}%`);
                    return null;
                }
            } catch { /* الفلتر لا يمنع الرفع عند أي عطل */ }

            // Single chokepoint: every upload path (camera, gallery,
            // crop-applied, crop-skipped, decode-fail) flows through here,
            // so compressing here guarantees no raw multi-MB photo ever
            // hits the network. This is the fix for the ~10s/image uploads.
            const file = await compressImage(rawFile, opts?.compress);
            // v13.32 — نسخة مصغّرة إضافية للبطاقات والقوائم. تُرفع باسم
            // `<الاسم>_t.jpg` بجوار الأصل، وتقرؤها الواجهة عبر thumbUrl()
            // التي ترتدّ للأصل تلقائياً لو لم توجد (صور ما قبل هذا الإصدار).
            // البنرات والشعارات لا تحتاجها (تُعرض بمقاس واحد) فتُخطّى.
            const wantThumb = opts?.thumb !== false;
            const thumb = wantThumb ? await compressImage(rawFile, THUMB) : null;
            // v14.57 — 🔴 كانت الصور تُرفع في **جذر المستودع** بلا مجلّد، وسياسة
            // الكتابة لا تفحص إلا امتداد الاسم: `bucket_id='deals' AND name LIKE
            // '%.jpg'`. أي أن **أي مستخدم موثَّق** — ولو مشترياً لا متجر له —
            // يرفع ما يشاء بأي اسم وبأي عدد، بما فيه أسماءٌ تبدو ملفّات تاجرٍ آخر.
            // الآن لكل مستخدم مجلّده باسم معرّفه، والسياسة تفرضه في القاعدة.
            const { data: authData } = await supabase.auth.getUser();
            const uid = authData?.user?.id;
            if (!uid) throw new Error('AUTH_REQUIRED');
            const stem = `${uid}/${Date.now()}_${Math.random().toString(36).substring(2)}`;
            const fileName = `${stem}.jpg`;
            logger.info(`📸 Uploading image: ${Math.round(rawFile.size/1024)}KB → ${Math.round(file.size/1024)}KB${thumb ? ` (مصغّرة ${Math.round(thumb.size/1024)}KB)` : ''}`);

            // Create a timeout promise
            const timeoutPromise = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('Upload Timeout')), 12000)
            );

            // v13.71 — نتيجة رفع المصغّرة (نجاح/فشل). الرابط لا يُوسَم بعلامة
            // المصغّرة إلا إذا تأكّد وصولها فعلاً — انظر thumb.ts.
            let thumbUploaded: Promise<boolean> | null = null;

            const uploadPromise = (async () => {
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('deals')
                    .upload(fileName, file, {
                        // v13.32 — سنة كاملة بدل ساعة: اسم الملف فريد ولا يُعاد
                        // استخدامه أبداً، فتخزين المتصفح والوسيط له آمن تماماً —
                        // والزائر العائد لا يُعيد تنزيل صورة رآها.
                        cacheControl: '31536000',
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                // المصغّرة: رفعها لا يُعطّل المنتج أبداً — لو فشلت يبقى الرابط
                // بلا علامة `?t=1` فتعرض الواجهةُ الأصلَ مباشرة (بلا طلب فاشل).
                if (thumb) {
                    thumbUploaded = supabase.storage.from('deals')
                        .upload(`${stem}_t.jpg`, thumb, { cacheControl: '31536000', upsert: false })
                        .then(({ error }) => {
                            if (error) logger.warn('thumb upload failed:', error.message);
                            return !error;
                        })
                        .catch(() => false);
                }

                const { data } = supabase.storage.from('deals').getPublicUrl(fileName);
                return data.publicUrl;
            })();

            // Race the upload against the timeout
            let result = await Promise.race([uploadPromise, timeoutPromise]);

            // v13.71 — الوسم يقع **بعد** تأكيد وصول المصغّرة، وخارج سباق المهلة
            // أعلاه حتى لا يتحوّل تأخّر مصغّرة إلى فشل رفعٍ نجح فعلاً. مهلة ٥
            // ثوانٍ للتأكيد: لو تأخّرت أو فشلت نُبقي الرابط بلا علامة فتُعرض
            // الصورة الأصلية — لا صورة ناقصة ولا طلب فاشل في الحالتين.
            if (result && thumbUploaded) {
                const ok = await Promise.race([
                    thumbUploaded,
                    new Promise<boolean>(r => setTimeout(() => r(false), 5000)),
                ]);
                if (ok) result = markThumbed(result);
            }

            if (result) {
                logger.info('✅ Image uploaded successfully:', result);
            }
            return result;
        } catch (error: any) {
            console.error('❌ Failed to upload image to Supabase:', error.message || error);
            // Fallback: we return null, the UI will handle local preview (Base64)
            return null; 
        }
    }
};
