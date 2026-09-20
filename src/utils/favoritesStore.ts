import { CONFIG } from '../config';

/**
 * favoritesStore — مفضلة الزائر (غير المسجَّل) · v14.63
 * ═══════════════════════════════════════════════════════════════════════════
 * المفتاح `taki_favorites` كان مُعلناً في `config.ts` منذ إصدارات **ولم
 * يُستعمل ولا مرّة**. الزائر الذي يعجبه عرضٌ قبل أن يسجّل كان لا يملك أي طريقة
 * لحفظه، فيفقده إن أغلق الصفحة.
 *
 * كل قراءة وكتابة ملفوفة بـtry: المتصفّح في الوضع الخاص أو الممتلئ الحصّة
 * يرمي عند الكتابة، ولا يجوز أن يُسقط ذلك زرّاً في الواجهة.
 */
const KEY = CONFIG.STORAGE_KEYS.FAVORITES;

export const guestFavorites = {
    read(): string[] {
        try {
            const raw = localStorage.getItem(KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
        } catch { return []; }
    },
    write(ids: string[]): void {
        try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* تجاهل */ }
    },
    clear(): void {
        try { localStorage.removeItem(KEY); } catch { /* تجاهل */ }
    },
};

export default guestFavorites;
