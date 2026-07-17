import { supabase } from './supabaseClient';

/**
 * v12.40 — «المحلل الذكي»: تتبع عمليات البحث (نص + نطاق) لتغذية قسم
 * «🔎 عمليات البحث» — منجم الطلب غير الملبّى. صامت تماماً: debounce ثانية
 * حتى لا تتحول الكتابة الحية لعشرات الأحداث، والقاعدة تمنع تكرار نفس
 * الكلمة من نفس المستخدم خلال ١٠ دقائق (track_search SECURITY DEFINER).
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';

export const trackSearch = (query: string, scope: 'home' | 'deals' | 'nearby'): void => {
    const q = (query || '').trim();
    if (timer) clearTimeout(timer);
    if (q.length < 2 || q.length > 80) return;
    timer = setTimeout(() => {
        const key = `${scope}:${q.toLowerCase()}`;
        if (key === lastSent) return;
        lastSent = key;
        supabase.rpc('track_search', { p_query: q, p_scope: scope }).then(
            () => { /* ok */ },
            () => { /* best-effort */ },
        );
    }, 1000);
};
