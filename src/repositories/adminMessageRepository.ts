/**
 * Admin Message Monitor (v11.24) — مراقبة الرسائل.
 *
 * Lets an admin watch every booking conversation live, open any thread with
 * both parties' identities + the booking barcode, delete a message, or warn a
 * user. All calls go through SECURITY DEFINER RPCs (admin-gated server-side),
 * so they bypass the party-only RLS on booking_messages.
 */
import { supabase } from '../services/supabaseClient';

export interface AdminThread {
    barcode: string;
    dealId: string | null;
    buyerId: string | null;
    buyerName: string | null;
    buyerPhone: string | null;
    sellerId: string | null;
    sellerName: string | null;
    sellerShop: string | null;
    bookingStatus: string | null;
    messageCount: number;
    lastBody: string | null;
    lastAt: string | null;
}

export interface AdminMessage {
    id: string;
    barcode: string;
    senderId: string | null;
    senderRole: string | null;
    senderName: string | null;
    body: string;
    createdAt: string;
    readAt: string | null;
}

export const adminMessageRepository = {
    listThreads: async (search?: string, limit = 100): Promise<AdminThread[]> => {
        const { data, error } = await supabase.rpc('admin_list_message_threads', {
            p_search: search?.trim() || null,
            p_limit: limit,
        });
        if (error) {
            console.error('[adminMessageRepository.listThreads]', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            barcode: r.barcode,
            dealId: r.deal_id,
            buyerId: r.buyer_id,
            buyerName: r.buyer_name,
            buyerPhone: r.buyer_phone,
            sellerId: r.seller_id,
            sellerName: r.seller_name,
            sellerShop: r.seller_shop,
            bookingStatus: r.booking_status,
            messageCount: Number(r.message_count) || 0,
            lastBody: r.last_body,
            lastAt: r.last_at,
        }));
    },

    getMessages: async (barcode: string): Promise<AdminMessage[]> => {
        const { data, error } = await supabase.rpc('admin_get_thread_messages', { p_barcode: barcode });
        if (error) {
            console.error('[adminMessageRepository.getMessages]', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            id: r.id,
            barcode: r.barcode,
            senderId: r.sender_id,
            senderRole: r.sender_role,
            senderName: r.sender_name,
            body: r.body,
            createdAt: r.created_at,
            readAt: r.read_at,
        }));
    },

    deleteMessage: async (id: string): Promise<{ success: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('admin_delete_message', { p_message_id: id });
        if (error) return { success: false, error: error.message };
        return { success: !!data?.success };
    },

    warnUser: async (userId: string, message: string): Promise<{ success: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('admin_warn_user', { p_user_id: userId, p_message: message });
        if (error) return { success: false, error: error.message };
        return { success: !!data?.success };
    },
};
