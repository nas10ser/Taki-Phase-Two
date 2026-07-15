import { supabase } from '../services/supabaseClient';

/**
 * Contests / Surveys with prizes (v11.44).
 *
 * Public users submit (name + phone + answers) through the `submit_contest_entry`
 * SECURITY DEFINER RPC, which auto-grades server-side — the client can never set
 * its own score/qualified. Entries (PII) are admin-read-only via RLS. The draw and
 * the masked public results are also definer RPCs. The admin builds questions with
 * correct answers; qualification is decided by `pass_mode`.
 */

export type QuestionType = 'text' | 'fill' | 'choice';

export interface ContestQuestion {
    id: string;
    type: QuestionType;
    prompt: string;
    options?: string[];        // choice only
    correctAnswer?: string;    // empty ⇒ not auto-graded (free answer)
    points?: number;           // default 1
    required?: boolean;
}

export interface SocialTask {
    id: string;
    prompt: string;            // e.g. «أين تابعت حسابنا؟» — self-declared text
}

export type ContestStatus = 'draft' | 'active' | 'closed' | 'drawn';
export type PassMode = 'all_correct' | 'any' | 'collect';
export type RevealPhone = 'full' | 'last4' | 'hidden';
export type ContestAudience = 'all' | 'buyers' | 'sellers';

export interface Contest {
    id: string;
    title: string;
    description: string;
    prize: string;
    status: ContestStatus;
    questions: ContestQuestion[];
    social_tasks: SocialTask[];
    pass_mode: PassMode;
    reveal_name: boolean;
    reveal_phone: RevealPhone;
    audience: ContestAudience;     // who the contest targets (v11.47)
    banner_image: string | null;   // optional custom hero-banner image (v11.49)
    starts_at: string | null;
    ends_at: string | null;
    created_at?: string;
}

export interface ContestEntry {
    id: string;
    contest_id: string;
    name: string;
    phone: string;
    answers: Record<string, string>;
    social_answers: Record<string, string>;
    score: number;
    max_score: number;
    qualified: boolean;
    is_winner: boolean;
    created_at: string;
}

export interface MaskedWinner { name: string; phone: string | null; }

/** v12.30 — «سحب مخصص»: draw straight from platform activity, no questions. */
export type DrawSource = 'buyers_booked' | 'stores_booked' | 'registered';
export type DrawRole = 'all' | 'buyers' | 'sellers';
export interface DrawWinner { id: string; name: string | null; phone: string | null; shop?: string | null; }
export interface CustomDraw {
    id: string;
    title: string;
    source: DrawSource;
    role_filter: DrawRole;
    from_ts: string | null;
    to_ts: string | null;
    winners_count: number;
    pool_size: number;
    winners: DrawWinner[];
    created_at: string;
}

/**
 * Is a contest LIVE right now for the public? Must be active AND inside its
 * scheduled window. A contest scheduled to start later stays invisible until
 * its `starts_at` passes — even if the admin pressed «تفعيل» early. (v11.46)
 */
export const isContestLive = (c: Contest): boolean => {
    if (c.status !== 'active') return false;
    const now = Date.now();
    if (c.starts_at && new Date(c.starts_at).getTime() > now) return false;
    if (c.ends_at && new Date(c.ends_at).getTime() < now) return false;
    return true;
};

/**
 * Should a contest appear on the public list? Only LIVE contests show — once a
 * contest ends, is stopped (closed), or has been drawn, it disappears entirely
 * (no «انتهت المسابقة» placeholder). A future `starts_at` also keeps it hidden
 * until it begins. (v11.47 — owner asked ended contests to vanish.)
 */
export const isContestPubliclyVisible = (c: Contest): boolean => isContestLive(c);

/**
 * Does this contest target the given user type? `all` → everyone; `sellers` →
 * sellers only; `buyers` → buyers + guests (potential shoppers). Admins always
 * see everything (so the owner can preview any audience). (v11.47)
 */
export const contestMatchesAudience = (c: Contest, userType?: string | null): boolean => {
    const aud = c.audience || 'all';
    if (aud === 'all' || userType === 'admin') return true;
    if (aud === 'sellers') return userType === 'seller';
    // buyers: anyone who isn't a seller (registered buyers + guests)
    return userType !== 'seller';
};

const sanitize = (r: any): Contest => ({
    id: r.id,
    title: r.title || '',
    description: r.description || '',
    prize: r.prize || '',
    status: (r.status as ContestStatus) || 'draft',
    questions: Array.isArray(r.questions) ? r.questions : [],
    social_tasks: Array.isArray(r.social_tasks) ? r.social_tasks : [],
    pass_mode: (r.pass_mode as PassMode) || 'all_correct',
    reveal_name: r.reveal_name !== false,
    reveal_phone: (r.reveal_phone as RevealPhone) || 'last4',
    audience: (r.audience as ContestAudience) || 'all',
    banner_image: r.banner_image ?? null,
    starts_at: r.starts_at ?? null,
    ends_at: r.ends_at ?? null,
    created_at: r.created_at,
});

export const contestRepository = {
    /** RLS returns active/closed/drawn to the public; everything to admins. */
    async list(): Promise<Contest[]> {
        const { data } = await supabase.from('contests').select('*').order('created_at', { ascending: false });
        return (data || []).map(sanitize);
    },

    async get(id: string): Promise<Contest | null> {
        const { data } = await supabase.from('contests').select('*').eq('id', id).maybeSingle();
        return data ? sanitize(data) : null;
    },

    async save(c: Partial<Contest>): Promise<{ success: boolean; error?: string; id?: string }> {
        const row: any = {
            title: (c.title || '').trim(),
            description: c.description || '',
            prize: c.prize || '',
            status: c.status || 'draft',
            questions: c.questions || [],
            social_tasks: c.social_tasks || [],
            pass_mode: c.pass_mode || 'all_correct',
            reveal_name: c.reveal_name !== false,
            reveal_phone: c.reveal_phone || 'last4',
            audience: c.audience || 'all',
            banner_image: c.banner_image || null,
            starts_at: c.starts_at || null,
            ends_at: c.ends_at || null,
            updated_at: new Date().toISOString(),
        };
        if (!row.title) return { success: false, error: 'العنوان مطلوب' };
        if (c.id) {
            const { error } = await supabase.from('contests').update(row).eq('id', c.id);
            return error ? { success: false, error: error.message } : { success: true, id: c.id };
        }
        const { data, error } = await supabase.from('contests').insert(row).select('id').maybeSingle();
        return error ? { success: false, error: error.message } : { success: true, id: data?.id };
    },

    async setStatus(id: string, status: ContestStatus): Promise<{ error?: any }> {
        return supabase.from('contests').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    },

    async remove(id: string): Promise<{ error?: any }> {
        return supabase.from('contests').delete().eq('id', id);
    },

    /** Admin only (RLS). Full PII rows for management + the draw. */
    async entries(contestId: string): Promise<ContestEntry[]> {
        const { data } = await supabase.from('contest_entries').select('*').eq('contest_id', contestId).order('created_at', { ascending: false });
        return (data || []) as ContestEntry[];
    },

    /** Public submit + server-side auto-grade. */
    async submit(
        contestId: string, name: string, phone: string,
        answers: Record<string, string>, social: Record<string, string>,
    ): Promise<{ success: boolean; qualified?: boolean; score?: number; max?: number; error?: string }> {
        const { data, error } = await supabase.rpc('submit_contest_entry', {
            p_contest_id: contestId, p_name: name, p_phone: phone, p_answers: answers, p_social: social,
        });
        if (error) return { success: false, error: error.message };
        const d = data as any;
        return { success: true, qualified: !!d?.qualified, score: d?.score, max: d?.max_score };
    },

    /**
     * Draw `count` NEW winners. Winners accumulate across draws and a previous
     * winner is never picked again — the returned list is only THIS draw's new
     * winners. (v11.49)
     */
    async draw(contestId: string, count: number): Promise<{ success: boolean; winners?: { name: string; phone: string }[]; error?: string }> {
        const { data, error } = await supabase.rpc('draw_contest_winners', { p_contest_id: contestId, p_count: count });
        if (error) return { success: false, error: error.message };
        return { success: true, winners: (data as any) || [] };
    },

    /** Clear all winners so the owner can redo the draw from scratch. (v11.49) */
    async resetWinners(contestId: string): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_reset_contest_winners', { p_contest_id: contestId });
        if (error) return { success: false, error: error.message };
        return { success: !!(data as any)?.success };
    },

    async publicResults(contestId: string): Promise<MaskedWinner[]> {
        const { data } = await supabase.rpc('contest_public_results', { p_contest_id: contestId });
        return (data as any) || [];
    },

    async counts(contestId: string): Promise<{ total: number; qualified: number }> {
        const { data } = await supabase.rpc('contest_counts', { p_contest_id: contestId });
        const d = data as any;
        return { total: d?.total || 0, qualified: d?.qualified || 0 };
    },

    /** The signed-in user's OWN entry status (powers the one-entry-per-user UX). */
    async myEntry(contestId: string): Promise<{ entered: boolean; qualified?: boolean; score?: number; max?: number }> {
        const { data } = await supabase.rpc('my_contest_entry', { p_contest_id: contestId });
        const d = data as any;
        return { entered: !!d?.entered, qualified: d?.qualified, score: d?.score, max: d?.max_score };
    },

    /**
     * v12.30 — «سحب مخصص»: server-side random draw from real activity
     * (buyers who booked / stores that received bookings / everyone who
     * registered) inside an arbitrary date window. Winners + pool size are
     * persisted in admin_draws for the history list.
     */
    async customDraw(params: {
        source: DrawSource; role: DrawRole;
        from: string | null; to: string | null;
        count: number; title: string;
    }): Promise<{ success: boolean; pool?: number; winners?: DrawWinner[]; error?: string }> {
        const { data, error } = await supabase.rpc('admin_custom_draw', {
            p_source: params.source,
            p_role: params.role,
            p_from: params.from,
            p_to: params.to,
            p_count: params.count,
            p_title: params.title,
        });
        if (error) return { success: false, error: error.message };
        const d = data as any;
        if (!d?.success) return { success: false, error: d?.error === 'empty_pool' ? 'لا يوجد أي مشارك مطابق في هذه الفترة.' : (d?.error || 'تعذّر السحب') };
        return { success: true, pool: d.pool, winners: d.winners || [] };
    },

    /**
     * v12.32 — pool size + a random name sample (≤40) so the custom draw can
     * spin the SAME slot-machine reel as the regular contest draw («قف» stops
     * on the server-chosen winner).
     */
    async drawPreview(params: {
        source: DrawSource; role: DrawRole;
        from: string | null; to: string | null;
    }): Promise<{ pool: number; sample: { id: string; name: string; phone: string }[] }> {
        const { data, error } = await supabase.rpc('admin_custom_draw_preview', {
            p_source: params.source,
            p_role: params.role,
            p_from: params.from,
            p_to: params.to,
        });
        if (error) return { pool: 0, sample: [] };
        const d = data as any;
        return { pool: Number(d?.pool) || 0, sample: Array.isArray(d?.sample) ? d.sample : [] };
    },

    /** History of custom draws (admin-only via RLS on admin_draws). */
    async listDraws(limit = 15): Promise<CustomDraw[]> {
        const { data } = await supabase
            .from('admin_draws')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        return (data || []).map((r: any) => ({
            ...r,
            winners: Array.isArray(r.winners) ? r.winners : [],
        })) as CustomDraw[];
    },
};
