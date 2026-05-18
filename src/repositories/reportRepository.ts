import { supabase } from '../services/supabaseClient';

export type ReportType =
    | 'scam'          // احتيال أو نصب
    | 'no_show'       // لم يحضر / لم يلتزم
    | 'harassment'    // تحرّش أو إساءة
    | 'inappropriate' // محتوى غير لائق
    | 'spam'          // إزعاج / رسائل مزعجة
    | 'other';        // أخرى

export type Role = 'buyer' | 'seller';

// The DB BEFORE-INSERT trigger (tr_guard_report_insert) is the source of
// truth: it re-derives + stamps the real roles from users.user_type and
// rejects same-role / self / admin-party reports. We still send roles to
// satisfy NOT NULL, but they cannot be used to spoof anything.
export const reportRepository = {
    create: async (input: {
        reporterId: string;
        reporterRole: Role;
        reportedId: string;
        reportedRole: Role;
        reportType: ReportType;
        reason: string;
    }): Promise<{ ok: boolean; code?: string }> => {
        const { error } = await supabase.from('reports').insert({
            reporter_id: input.reporterId,
            reporter_role: input.reporterRole,
            reported_id: input.reportedId,
            reported_role: input.reportedRole,
            report_type: input.reportType,
            reason: input.reason.trim(),
        });
        if (error) {
            console.warn('report insert failed:', error.message);
            const m = error.message || '';
            let code = 'generic';
            if (/SAME_ROLE_REPORT_BLOCKED/.test(m)) code = 'same_role';
            else if (/SELF_REPORT_NOT_ALLOWED/.test(m)) code = 'self';
            else if (/REPORT_ROLE_NOT_ALLOWED/.test(m)) code = 'role_not_allowed';
            else if (/INVALID_REPORT_PARTIES/.test(m)) code = 'invalid';
            else if (/row-level security|RLS|permission/i.test(m)) code = 'forbidden';
            return { ok: false, code };
        }
        return { ok: true };
    },
};
