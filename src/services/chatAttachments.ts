/**
 * chatAttachments — صور داخل محادثة الطلب (v14.27)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرار ناصر: المرفق يعيش **داخل محادثة الطلب** بين المشتري والتاجر، لا في
 * نموذج شكوى ولا عند الإدارة — «لا أريد لتاكي أن تتدخّل إلا في حال تصعّد
 * الموضوع».
 *
 * ولذلك المستودع `chat` **خاصّ**: لا يُفتح بعنوان مباشر مهما عُرف، وإنما
 * برابط موقّع قصير العمر يُصدره الخادم لعضو المحادثة وحده. مستودع `deals`
 * عام لأن العروض للناس — أمّا صورة منتجٍ تالف في نزاع فليست كذلك.
 */
import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

const BUCKET = 'chat';
const MAX_BYTES = 5 * 1024 * 1024;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export interface UploadResult { ok: boolean; path?: string; error?: string }

const extOf = (f: File) => {
    const fromName = (f.name.split('.').pop() || '').toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
    return (f.type.split('/')[1] || 'jpg').toLowerCase();
};

export const chatAttachments = {
    /**
     * يرفع صورة تحت مجلّد الباركود. المسار جزءٌ من الحماية لا تنظيمٌ فقط:
     * سياسة التخزين تقرأ الجزء الأول منه وتسأل القاعدة «هل هذا المستخدم طرفٌ
     * في هذا الحجز؟» — فملفٌ خارج مجلّد باركودك يُرفض عند الرفع لا عند القراءة.
     */
    upload: async (barcode: string, file: File): Promise<UploadResult> => {
        if (!file) return { ok: false, error: 'NO_FILE' };
        if (file.size > MAX_BYTES) {
            return { ok: false, error: `الصورة أكبر من ٥ ميجابايت (${(file.size / 1048576).toFixed(1)})` };
        }
        // بعض أجهزة أندرويد ترسل type فارغاً — نقبلها ونتّكل على فحص المستودع.
        if (file.type && !OK_TYPES.includes(file.type)) {
            return { ok: false, error: 'الصيغة غير مدعومة — أرسل صورة (JPG أو PNG).' };
        }
        const name = `${barcode}/${crypto.randomUUID()}.${extOf(file)}`;
        const { error } = await supabase.storage.from(BUCKET).upload(name, file, {
            cacheControl: '31536000',
            upsert: false,
            contentType: file.type || 'image/jpeg',
        });
        if (error) {
            logger.warn('chat upload:', error.message);
            return { ok: false, error: 'تعذّر رفع الصورة. تأكّد من اتصالك وحاول مجدداً.' };
        }
        return { ok: true, path: name };
    },

    /** رابط موقّت لعرض المرفق. ساعة تكفي لجلسة قراءة ولا تصلح للمشاركة الدائمة. */
    signedUrl: async (path: string): Promise<string | null> => {
        try {
            const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
            if (error || !data?.signedUrl) return null;
            return data.signedUrl;
        } catch { return null; }
    },
};

export default chatAttachments;
