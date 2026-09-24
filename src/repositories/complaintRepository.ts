/**
 * complaintRepository — الشكوى صارت محادثة (v14.92)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ما كان: ثلاثة حقولٍ تُرسل ثم صمت. لا مرفق، ولا شاشةٌ تعرض للمستخدم
 *    شكاواه، ولا ردٌّ يصله. والإدارة تغيّر الحالة إلى «تم الحل» فلا يعلم
 *    صاحب الشكوى شيئاً.
 *
 * 🔴 وأسوأ من النقص أن **سياستنا المنشورة كانت تَعِد بما لا يقبله النموذج**:
 *    صفحة الاسترداد توجّه المشتري إلى زرّ الشكوى وتطلب رقم العملية ولقطة
 *    كشف البنك — ولا حقل مرفقٍ واحد. (وعدٌ في نصٍّ قانونيّ بلا كودٍ ينفّذه.)
 *
 * ما صار: مرفقاتٌ في مستودعٍ **خاص** لا يقرؤها إلا صاحبها وفريق الإدارة،
 * وردودٌ في الاتجاهين، وإشعارٌ يصل صاحب الشكوى عند كل ردٍّ من الإدارة.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type ComplaintCategory =
    | 'app_issue'    // مشكلة في التطبيق
    | 'store_issue'  // مشكلة مع متجر
    | 'payment'      // مشكلة دفع/سعر
    | 'suggestion'   // اقتراح/تحسين
    | 'other';       // أخرى

export type ComplaintStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface MyComplaint {
    id: string;
    category: ComplaintCategory;
    subject: string | null;
    message: string;
    status: ComplaintStatus;
    attachments: string[];
    created_at: string;
    reply_count: number;
    last_reply_at: string | null;
    /** ردٌّ من الإدارة لم يُردَّ عليه بعد — يُبرز البطاقة في «شكاواي». */
    unread_admin: boolean;
}

export interface ComplaintReply {
    id: string;
    author_role: 'admin' | 'user';
    author_name: string;
    body: string;
    created_at: string;
}

const BUCKET = 'complaints';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;
const OK_TYPES = [
    'image/jpeg', 'image/png', 'image/webp',
    // 🪤 heic/heif ليستا رفاهية: كاميرا آيفون تُخرجهما، وغيابُهما يرفض صورة
    //    هاتفٍ عادية **بقيد الصيغة لا الحجم** (درس v14.72).
    'image/heic', 'image/heif',
    'application/pdf',   // كشف الحساب البنكي الذي تطلبه سياسة الاسترداد
];

const extOf = (f: File) => {
    const fromName = (f.name.split('.').pop() || '').toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
    return (f.type.split('/')[1] || 'jpg').toLowerCase();
};

export const complaintRepository = {
    MAX_FILES,

    /** الشكوى نفسها — تُرجع المعرّف كي تُربط به المرفقات بعد رفعها. */
    create: async (input: {
        userId: string;
        userRole?: string;
        category: ComplaintCategory;
        subject?: string;
        message: string;
        targetId?: string | null;
    }): Promise<{ ok: boolean; id?: string; msg?: string }> => {
        // 🪤 `.select()` ليس تجميلاً: بلا صفٍّ مُعاد لا نعرف معرّف الشكوى فلا
        //    نستطيع ربط المرفقات بها — وكتابةٌ ترفضها RLS تعود `error=null`
        //    وصفر صفوف، فتبدو نجاحاً (درس «الأزرار الصامتة»).
        const { data, error } = await supabase
            .from('complaints')
            .insert({
                user_id: input.userId,
                user_role: input.userRole ?? null,
                category: input.category,
                subject: input.subject?.trim() || null,
                message: input.message.trim(),
                target_id: input.targetId ?? null,
            })
            .select('id')
            .single();

        if (error) {
            logger.warn('complaint insert failed:', error.message);
            // v13.15 — حدّ الطلبات (P0011): رسالة القاعدة العربية تُعرض كما هي
            return { ok: false, msg: (error as any).code === 'P0011' ? error.message : undefined };
        }
        if (!data?.id) return { ok: false };
        return { ok: true, id: data.id as string };
    },

    /**
     * رفع مرفق. المسار `<user_id>/<complaint_id>/<uuid>.<ext>` جزءٌ من الحماية
     * لا تنظيمٌ فقط: سياسة التخزين تقرأ أوّل مقطعٍ منه وترفض الكتابة خارج
     * مجلّد صاحبها — فالرفض عند الرفع لا عند القراءة.
     */
    uploadAttachment: async (
        userId: string, complaintId: string, file: File,
    ): Promise<{ ok: boolean; path?: string; error?: string }> => {
        if (!file) return { ok: false, error: 'لم يُختَر ملف.' };
        if (file.size > MAX_BYTES) {
            return { ok: false, error: `الملف أكبر من ٥ ميجابايت (${(file.size / 1048576).toFixed(1)}).` };
        }
        // بعض أجهزة أندرويد ترسل `type` فارغاً — نقبلها ونتّكل على فحص المستودع.
        if (file.type && !OK_TYPES.includes(file.type)) {
            return { ok: false, error: 'الصيغة غير مدعومة — أرفق صورة أو ملف PDF.' };
        }
        const name = `${userId}/${complaintId}/${crypto.randomUUID()}.${extOf(file)}`;
        const { error } = await supabase.storage.from(BUCKET).upload(name, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'image/jpeg',
        });
        if (error) {
            logger.warn('complaint attachment upload:', error.message);
            return { ok: false, error: 'تعذّر رفع المرفق. تأكّد من اتصالك وحاول مجدداً.' };
        }
        return { ok: true, path: name };
    },

    /** يربط المسارات المرفوعة بالشكوى (يتحقّق الخادم أنها داخل مجلّد صاحبها). */
    saveAttachments: async (complaintId: string, paths: string[]): Promise<boolean> => {
        const { error } = await supabase.rpc('complaint_set_attachments', {
            p_id: complaintId, p_paths: paths,
        });
        if (error) { logger.warn('complaint_set_attachments:', error.message); return false; }
        return true;
    },

    /** رابطٌ موقّت لعرض المرفق — ساعة تكفي لجلسة قراءة ولا تصلح للمشاركة. */
    signedUrl: async (path: string): Promise<string | null> => {
        try {
            const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
            if (error || !data?.signedUrl) return null;
            return data.signedUrl;
        } catch { return null; }
    },

    /** شكاواي — القائمة التي لم تكن موجودة إطلاقاً. */
    mine: async (limit = 50): Promise<MyComplaint[]> => {
        const { data, error } = await supabase.rpc('my_complaints', { p_limit: limit });
        if (error) { logger.warn('my_complaints:', error.message); return []; }
        return (data ?? []) as MyComplaint[];
    },

    /** خيط الشكوى: ردودها بالترتيب. */
    thread: async (complaintId: string): Promise<ComplaintReply[]> => {
        const { data, error } = await supabase.rpc('complaint_thread', { p_id: complaintId });
        if (error) { logger.warn('complaint_thread:', error.message); return []; }
        return (data ?? []) as ComplaintReply[];
    },

    /** ردُّ صاحب الشكوى — ويعيد شكواه «مفتوحة» إن كانت مُغلقة. */
    reply: async (complaintId: string, body: string): Promise<{ ok: boolean; msg?: string }> => {
        const { error } = await supabase.rpc('complaint_reply', { p_id: complaintId, p_body: body });
        if (error) {
            logger.warn('complaint_reply:', error.message);
            return { ok: false, msg: (error as any).code === 'P0011' ? error.message : undefined };
        }
        return { ok: true };
    },
};
