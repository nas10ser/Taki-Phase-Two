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

/**
 * مسارٌ داخليّ أو `null` — **الموضع الوحيد** لهذا الحكم في الواجهة.
 *
 * v15.79 — صُدِّرت لأن شاشةَ الإشعارات كانت تحمل نسخةً **أضعف**
 * (`startsWith('/')` وحدها) فتقبل `//host` ⇒ وجهةً خارج الموقع.
 *
 * 🪤 وقِيس أن `startsWith('//')` وحدها **لا تكفي**: الشرطةُ المائلة العكسية
 *    تُحوَّل إلى `/` في المخططات الخاصّة، فـ`new URL('/\\evil.com/x',
 *    'https://www.takisa.net').href === 'https://evil.com/x'` — مسارٌ يبدو
 *    داخلياً للعين وللشرط، وللمتصفّح مضيفٌ آخر. فالحكمُ بالقياس لا بالنمط:
 *    يُحلّ المسارُ على أصلٍ وهميّ ويُشترط بقاءُ الأصل كما هو.
 */
export const safeInternalPath = (path: string | null | undefined): string | null => {
    if (!path || typeof path !== 'string') return null;
    if (!path.startsWith('/') || path.length > 512) return null;
    const BASE = 'https://taki.invalid';
    try { if (new URL(path, BASE).origin !== BASE) return null; } catch { return null; }
    return path;
};

const safe = (path: string | null | undefined): string | null => {
    const p = safeInternalPath(path);
    if (!p) return null;
    const base = p.split('?')[0].split('#')[0];
    if (BLOCKED.some(b => base === b || base.startsWith(b + '/'))) return null;
    return p;
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
