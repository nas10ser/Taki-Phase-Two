import { supabase } from '../services/supabaseClient';

export type ComplaintCategory =
    | 'app_issue'    // مشكلة في التطبيق
    | 'store_issue'  // مشكلة مع متجر
    | 'payment'      // مشكلة دفع/سعر
    | 'suggestion'   // اقتراح/تحسين
    | 'other';       // أخرى

// User-submitted complaint to the admin (#3). RLS complaints_insert_self
// only allows writing rows for one's own auth uid.
export const complaintRepository = {
    create: async (input: {
        userId: string;
        userRole?: string;
        category: ComplaintCategory;
        subject?: string;
        message: string;
        targetId?: string | null;
    }): Promise<{ ok: boolean }> => {
        const { error } = await supabase.from('complaints').insert({
            user_id: input.userId,
            user_role: input.userRole ?? null,
            category: input.category,
            subject: input.subject?.trim() || null,
            message: input.message.trim(),
            target_id: input.targetId ?? null,
        });
        if (error) {
            console.warn('complaint insert failed:', error.message);
            return { ok: false };
        }
        return { ok: true };
    },
};
