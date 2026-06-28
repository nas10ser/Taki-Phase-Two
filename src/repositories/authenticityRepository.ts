import { supabase } from '../services/supabaseClient';

/**
 * authenticityRepository — buyer votes on whether an OFFER is real or fake.
 *
 * One vote per (deal, user); re-voting updates. Writes go through the
 * SECURITY DEFINER RPC `cast_authenticity_vote` (reads auth.uid(), resolves the
 * store server-side) so the client never needs INSERT rights on the table and
 * the voter's identity is never exposed publicly. Aggregate counts come from
 * `authenticity_counts` (also DEFINER) which returns per-deal real/fake totals
 * plus the caller's own vote. v11.97
 */
export interface AuthenticityCount {
    dealId: string;
    realCount: number;
    fakeCount: number;
    myVote: boolean | null;
}

export const authenticityRepository = {
    /** Record (or change) the caller's real/fake vote for a deal. */
    vote: async (dealId: string, isReal: boolean): Promise<boolean> => {
        const { error } = await supabase.rpc('cast_authenticity_vote', {
            p_deal_id: dealId,
            p_is_real: isReal,
        });
        if (error) {
            console.error('cast_authenticity_vote failed:', error.message);
            return false;
        }
        return true;
    },

    /** Per-deal real/fake counts (+ caller's own vote) for a batch of deals. */
    counts: async (dealIds: string[]): Promise<Record<string, AuthenticityCount>> => {
        if (!dealIds || dealIds.length === 0) return {};
        const { data, error } = await supabase.rpc('authenticity_counts', { p_deal_ids: dealIds });
        if (error) {
            console.warn('authenticity_counts failed:', error.message);
            return {};
        }
        const out: Record<string, AuthenticityCount> = {};
        for (const r of (data || []) as any[]) {
            out[r.deal_id] = {
                dealId: r.deal_id,
                realCount: Number(r.real_count) || 0,
                fakeCount: Number(r.fake_count) || 0,
                myVote: typeof r.my_vote === 'boolean' ? r.my_vote : null,
            };
        }
        return out;
    },
};
