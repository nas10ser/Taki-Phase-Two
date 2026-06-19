import { supabase } from '../services/supabaseClient';

export interface AppNotification {
    id: string;
    userId: string;
    title: { ar: string, en: string };
    body: { ar: string, en: string };
    type: 'booking' | 'deal' | 'system' | 'rating' | 'follow' | 'marketing';
    isRead: boolean;
    createdAt: number;
    metadata?: any;
}

export const notificationRepository = {
    fetchByUserId: async (userId: string): Promise<AppNotification[]> => {
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            return (data || []).map(n => ({
                id: n.id,
                userId: n.user_id,
                title: { ar: n.title_ar, en: n.title_en },
                body: { ar: n.body_ar, en: n.body_en },
                type: n.type as any,
                isRead: n.is_read,
                createdAt: new Date(n.created_at).getTime(),
                metadata: n.meta_data
            }));
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
