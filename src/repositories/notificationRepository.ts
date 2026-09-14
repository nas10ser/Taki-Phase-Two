import { supabase } from '../services/supabaseClient';

export interface AppNotification {
    id: string;
    userId: string;
    title: { ar: string, en: string };
    body: { ar: string, en: string };
    /** 🪤 `report` موجود في الواجهة ولا تسمح به قيود الجدول اليوم (٦ أنواع فقط)،
     *  فتوجيه «تقرير بلاغات» في صفحة الإشعارات فرعٌ ميت لا يُنفَّذ أبداً.
     *  أُبقي في النوع كي لا يتعطّل الفرع يوم يُوسَّع القيد. */
    type: 'booking' | 'deal' | 'system' | 'rating' | 'follow' | 'marketing' | 'report';
    isRead: boolean;
    createdAt: number;
    metadata?: any;
}

export interface NotifPage {
    rows: AppNotification[];
    hasMore: boolean;
    unreadTotal: number;
    total: number;
    cursor: { at: string; id: string } | null;
}

const fromRow = (n: any): AppNotification => ({
    id: n.id,
    userId: n.user_id,
    title: { ar: n.title_ar, en: n.title_en },
    body: { ar: n.body_ar, en: n.body_en },
    type: n.type as any,
    isRead: n.is_read,
    createdAt: new Date(n.created_at).getTime(),
    metadata: n.meta_data,
});

export const notificationRepository = {
    /**
     * صفحة من الإشعارات بترقيم المفتاح (v14.26).
     *
     * 🪤 ما كان قبله: `fetchByUserId` تجلب ١٠٠ وتتوقّف، والشاشة تعرضها كلها بلا
     * زرّ «المزيد». قِيس على الإنتاج في ١٤ سبتمبر: حسابٌ لديه ٧٤٧ إشعاراً، أي
     * **٦٤٧ إشعاراً غير مرئية**، وعدّادُ الشريط السفلي يعدّ غير المقروء داخل
     * المئة وحدها فيكذب على صاحبه.
     *
     * المؤشّر مركّب `(created_at, id)` لا `created_at` وحده: إشعارات الحجز
     * الواحد تُكتب في نفس اللحظة من نفس المشغّل، فبلا فاصلٍ ثانٍ ثابت يتكرّر
     * صفٌّ ويُبتلع آخر عند حدّ الصفحة.
     */
    browsePage: async (
        cursor?: { at: string; id: string } | null,
        limit = 40,
    ): Promise<NotifPage> => {
        const empty: NotifPage = { rows: [], hasMore: false, unreadTotal: 0, total: 0, cursor: null };
        try {
            const { data, error } = await supabase.rpc('browse_notifications', {
                p_cursor_at: cursor?.at ?? null,
                p_cursor_id: cursor?.id ?? null,
                p_limit: limit,
            });
            if (error) { console.warn('browse_notifications:', error.message); return empty; }
            const d: any = data || {};
            if (!d.ok) return empty;
            const raw: any[] = Array.isArray(d.rows) ? d.rows : [];
            const last = raw[raw.length - 1];
            return {
                rows: raw.map(fromRow),
                hasMore: !!d.has_more,
                unreadTotal: Number(d.unread_total) || 0,
                total: Number(d.total) || 0,
                cursor: last ? { at: last.created_at, id: last.id } : null,
            };
        } catch { return empty; }
    },


    fetchByUserId: async (userId: string): Promise<AppNotification[]> => {
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            return (data || []).map(fromRow);
        } catch (error) {
            console.warn('❌ Failed to fetch notifications:', error);
            return [];
        }
    },

    save: async (notif: AppNotification): Promise<void> => {
        try {
            const dbData = {
                id: notif.id,
                user_id: notif.userId,
                title_ar: notif.title.ar,
                title_en: notif.title.en,
                body_ar: notif.body.ar,
                body_en: notif.body.en,
                type: notif.type,
                is_read: notif.isRead,
                meta_data: notif.metadata || {},
                created_at: new Date(notif.createdAt).toISOString()
            };

            const { error } = await supabase.from('notifications').upsert(dbData);
            if (error) throw error;
        } catch (error) {
            console.warn('❌ Failed to save notification:', error);
        }
    },

    markAsRead: async (id: string): Promise<void> => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('id', id);

            if (error) throw error;
        } catch (error) {
            console.warn('❌ Failed to mark notification as read:', error);
        }
    },

    // Mark every unread notification for a user as read in one round-trip — powers
    // the "قراءة الكل / Mark all read" button. RLS (notifs_update_own) restricts the
    // UPDATE to the caller's own rows, so user_id must be the signed-in user.
    markAllAsRead: async (userId: string): Promise<void> => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', userId)
                .eq('is_read', false);

            if (error) throw error;
        } catch (error) {
            console.warn('❌ Failed to mark all notifications as read:', error);
        }
    },

    deleteByUser: async (userId: string): Promise<void> => {
        try {
            await supabase.from('notifications').delete().eq('user_id', userId);
        } catch (error) {
            console.warn('❌ Failed to delete notifications:', error);
        }
    }
};
