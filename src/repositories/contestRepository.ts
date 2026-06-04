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
 * Should a contest appear on the public list? Drawn/closed always show (results
 * / waiting state). An active contest only shows once it has started — a future
 * `starts_at` keeps it hidden from participants until the moment it begins.
 */
export const isContestPubliclyVisible = (c: Contest): boolean => {
    if (c.status === 'active') {
        if (c.starts_at && new Date(c.starts_at).getTime() > Date.now()) return false;
        return true;
    }
    return c.status === 'closed' || c.status === 'drawn';
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

    async draw(contestId: string, count: number): Promise<{ success: boolean; winners?: { name: string; phone: string }[]; error?: string }> {
        const { data, error } = await supabase.rpc('draw_contest_winners', { p_contest_id: contestId, p_count: count });
        if (error) return { success: false, error: error.message };
        return { success: true, winners: (data as any) || [] };
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
};
