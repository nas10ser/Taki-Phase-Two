import { supabase } from './supabaseClient';

/**
 * siteVisit — قياس الزائر ومصدره (v14.80).
 * ═══════════════════════════════════════════════════════════════════════════
 * ما كان ناقصاً: كل قياسات المنصّة مربوطةٌ بـ`store_id` — فزائرٌ يفتح الصفحة
 * الرئيسية ثم يخرج **غير مرئيّ تماماً**. ولا `document.referrer` ولا `utm_*`
 * في المستودع كلّه. فلا جواب لثلاثة أسئلة يحتاجها يوم الإطلاق:
 *   كم زائراً · من أي قناة · وأي صفحة أوقفتهم.
 *
 * ── ما لا يُرسَل من هنا عمداً ───────────────────────────────────────────────
 *  • لا كعكة ولا بصمة جهاز ولا معرّف دائم. المعرّف من `sessionStorage` يموت
 *    بإغلاق التبويب، وهو **نفس معرّف `analyticsTracker`** فلا معرّفان لشخصٍ واحد.
 *  • المُحيل يُرسَل كما هو **ويُقصّ على الخادم إلى اسم المضيف وحده** — القصّ في
 *    القاعدة لا هنا، فلا تُصلحه نسخةٌ وتنساه أخرى.
 *  • العنوان يُرسَل بمساره فقط؛ والاستعلام يُسقطه الخادم (فلا يُخزَّن باركود
 *    أو رمز دعوةٍ وقع في الرابط).
 *
 * 🪤 و**صامتٌ تماماً**: أي فشلٍ هنا يُبتلع. القياس لا يجوز أن يُعطّل تصفّحاً —
 *    وهو نفس مبدأ `analyticsTracker`.
 * 🪤 و`utm` تُلتقط **مرّة واحدة عند أول صفحة** وتُحفظ في الجلسة: الخادم يُسند
 *    لأوّل لمسة، ولو أرسلناها مع كل تنقّلٍ لضاعت عند أول رابطٍ داخلي.
 */

const SESSION_KEY = 'taki_an_sid';   // نفس مفتاح analyticsTracker — معرّفٌ واحد
const SENT_KEY = 'taki_visit_sent';

/** نفس اشتقاق analyticsTracker حرفياً حتى لا يفترق المعرّفان. */
const sessionId = (): string => {
    try {
        let s = sessionStorage.getItem(SESSION_KEY);
        if (!s) {
            s = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem(SESSION_KEY, s);
        }
        return s;
    } catch {
        return '';
    }
};

const device = (): 'mobile' | 'tablet' | 'desktop' => {
    try {
        const w = window.innerWidth;
        const touch = navigator.maxTouchPoints > 0;
        if (touch && w < 768) return 'mobile';
        if (touch && w < 1180) return 'tablet';
        return 'desktop';
    } catch {
        return 'desktop';
    }
};

const isStandalone = (): boolean => {
    try {
        return window.matchMedia?.('(display-mode: standalone)')?.matches === true
            || (navigator as any).standalone === true;
    } catch {
        return false;
    }
};

/** وسوم الحملة من العنوان — تُقرأ مرّة ثم تُحفظ للجلسة. */
const campaign = (): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
        const q = new URLSearchParams(window.location.search);
        const map: Record<string, string> = {
            utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign', ref: 'ref',
        };
        for (const [k, v] of Object.entries(map)) {
            const val = q.get(k);
            if (val) out[v] = val.slice(0, 64);
        }
    } catch { /* عنوان غير قابل للتحليل */ }
    return out;
};

let lastPath = '';
let inFlight = false;

/**
 * يُنادى عند أول تحميل وعند كل تغيّر مسار. أول نداءٍ في الجلسة يحمل المصدر،
 * وما بعده تحديثٌ خفيف (الخادم لا يُنشئ صفّاً ثانياً).
 */
export const trackVisit = (path: string): void => {
    const sid = sessionId();
    if (!sid) return;

    const p = (path || '/').split('?')[0].split('#')[0] || '/';
    if (p === lastPath || inFlight) return;
    lastPath = p;

    let first = false;
    try {
        first = sessionStorage.getItem(SENT_KEY) !== '1';
        if (first) sessionStorage.setItem(SENT_KEY, '1');
    } catch { /* تخزينٌ محجوب — تُعامَل كأنها أولى */ first = true; }

    inFlight = true;
    // 🪤 مُنشئ Supabase ليس Promise كاملاً (PromiseLike بلا `.catch`) —
    //    فالالتفاف بـ`Promise.resolve` هو ما يجعل الابتلاع الصامت ممكناً فعلاً.
    Promise.resolve(supabase
        .rpc('track_site_visit', {
            p_session: sid,
            p_path: p,
            // المُحيل يُفيد في أول نداءٍ وحده — بعده يصير عنوان موقعنا نفسه.
            p_referrer: first ? (document.referrer || null) : null,
            p_utm: first ? campaign() : {},
            p_device: device(),
            p_pwa: isStandalone(),
            p_lang: document.documentElement.lang === 'en' ? 'en' : 'ar',
        }))
        .catch(() => { /* صامت: القياس لا يُعطّل تصفّحاً */ })
        .finally(() => { inFlight = false; });
};

/** يُنادى بعد حجزٍ ناجح — فيصير التحويل قابلاً للقياس لا الزيارات وحدها. */
export const markVisitBooked = (): void => {
    const sid = sessionId();
    if (!sid) return;
    Promise.resolve(supabase.rpc('taki_mark_session_booked', { p_session: sid }))
        .catch(() => { /* صامت */ });
};
