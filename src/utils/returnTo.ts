/**
 * returnTo — أعِد الزائر إلى حيث كان (v14.28)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ما كان قبله: زائرٌ يفتح رابط عرضٍ من واتساب، يضغط «احجز»، فيُدفع إلى
 * التسجيل. وبعد أن ينجح يجد نفسه على **الرئيسية** — والعرض الذي جاء من أجله
 * اختفى. عليه أن يبحث عنه من جديد، وكثيرون لا يفعلون.
 *
 * `sessionStorage` لا `localStorage` عمداً: الوجهة تخصّ هذه الجلسة وحدها.
 * وتبويبٌ فُتح أمس لا يخطف وجهة تبويب اليوم.
 */
const KEY = 'taki_return_to';

/** المسارات التي لا يجوز أن تكون وجهة عودة: لأنها تُعيدك إلى الحلقة نفسها. */
const BLOCKED = ['/register', '/complete-profile', '/login', '/auth'];

const safe = (path: string | null | undefined): string | null => {
    if (!path || typeof path !== 'string') return null;
    // مسار داخلي فقط. `//host` و`https://host` كلاهما يخرج من الموقع، و`//`
    // خصوصاً يبدو داخلياً للعين وليس كذلك للمتصفّح.
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    const base = path.split('?')[0].split('#')[0];
    if (BLOCKED.some(b => base === b || base.startsWith(b + '/'))) return null;
    if (path.length > 512) return null;
    return path;
};

export const returnTo = {
    save(path: string) {
        const v = safe(path);
        try { if (v) sessionStorage.setItem(KEY, v); } catch { /* وضع التصفّح الخاص */ }
    },
    /** يقرأ ويمسح: وجهةٌ تُستهلك مرّة واحدة، فلا تُعيدك بعد شهر. */
    take(): string | null {
        try {
            const v = safe(sessionStorage.getItem(KEY));
            sessionStorage.removeItem(KEY);
            return v;
        } catch { return null; }
    },
    clear() { try { sessionStorage.removeItem(KEY); } catch { /* تجاهل */ } },
};

/** يحفظ المكان الحالي ثم يدفع الزائر للتسجيل. استعملها بدل `history.push('/register')`. */
export function goRegister(history: { push: (p: string) => void }, from?: string) {
    const here = from
        ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
    returnTo.save(here);
    history.push('/register');
}

export default returnTo;
