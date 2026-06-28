import { supabase } from '../services/supabaseClient';

export interface Rating {
    id: string;
    dealId: string;
    userId: string;
    userName: string;
    score: number;
    comment: string;
    reply?: string | null;
    repliedBy?: string | null;
    repliedAt?: string | null;
    createdAt: string;
    likedBy: string[];
    likeCount: number;
}

const fromRow = (r: any): Rating => ({
    id: r.id,
    dealId: r.deal_id,
    userId: r.user_id,
    userName: r.user_name,
    score: Number(r.score) || 0,
    comment: r.comment ?? '',
    reply: r.reply ?? null,
    repliedBy: r.replied_by ?? null,
    repliedAt: r.replied_at ?? null,
    createdAt: r.created_at,
    likedBy: Array.isArray(r.liked_by) ? r.liked_by : [],
    likeCount: Number(r.like_count) || 0,
});

export const ratingRepository = {
    listForDeal: async (dealId: string): Promise<Rating[]> => {
        const { data, error } = await supabase
            .from('ratings')
            .select('*')
            .eq('deal_id', dealId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
        if (error) {
            console.warn('listForDeal failed:', error.message);
            return [];
        }
        return (data || []).map(fromRow);
    },

    listForStore: async (storeId: string): Promise<Rating[]> => {
        // Join to deals via FK so we can filter by storeId in one round trip.
        const { data: dealRows } = await supabase
            .from('deals')
            .select('id')
            .eq('store_id', storeId);
        const ids = (dealRows || []).map(d => d.id);
        if (ids.length === 0) return [];
        const { data, error } = await supabase
            .from('ratings')
            .select('*')
            .in('deal_id', ids)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
        if (error) {
            console.warn('listForStore failed:', error.message);
            return [];
        }
        return (data || []).map(fromRow);
    },

    create: async (input: {
        dealId: string;
        userId: string;
        userName: string;
        score: number;
        comment: string;
    }): Promise<Rating | 'duplicate' | null> => {
        const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
            ? (crypto as any).randomUUID()
            : `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const row = {
            id,
            deal_id: input.dealId,
            user_id: input.userId,
            user_name: input.userName,
            score: input.score,
            comment: input.comment,
        };
        const { data, error } = await supabase.from('ratings').insert(row).select().maybeSingle();
        if (error) {
            // 23505 = unique violation. The DB enforces ONE active rating per
            // (store, user) [ratings_store_user_active_uq] AND per (deal, user];
            // either means the buyer already rated this store. v11.97b
            if ((error as any).code === '23505') return 'duplicate';
            console.error('Rating insert failed:', error.message);
            return null;
        }
        return data ? fromRow(data) : null;
    },

    toggleLike: async (ratingId: string): Promise<{ likeCount: number; liked: boolean } | null> => {
        const { data, error } = await supabase.rpc('toggle_rating_like', { p_rating_id: ratingId });
        if (error) {
            console.warn('toggleLike RPC failed:', error.message);
            return null;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;
        return { likeCount: Number(row.like_count) || 0, liked: !!row.liked };
    },

    setReply: async (ratingId: string, reply: string): Promise<boolean> => {
        const { error } = await supabase.rpc('set_rating_reply', { p_rating_id: ratingId, p_reply: reply });
        if (error) {
            console.error('set_rating_reply failed:', error.message);
            return false;
        }
        return true;
    },

    remove: async (ratingId: string): Promise<boolean> => {
        const { error } = await supabase.rpc('delete_rating', { p_rating_id: ratingId });
        if (error) {
            console.error('delete_rating failed:', error.message);
            return false;
        }
        return true;
    },
};
