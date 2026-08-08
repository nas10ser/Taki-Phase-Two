/**
 * موقع المستخدم داخل تيليجرام (v13.79).
 *
 * سؤال ناصر: «هل التطبيق والبوتات يختلف الوضع؟» — نعم، ولهذا الملف.
 *
 * حين يُفتح تاكي **داخل تيليجرام** (Mini App) فهو يعمل في متصفّح تيليجرام
 * المدمج، لا في سفاري/كروم. صلاحية الموقع هناك ليست صلاحية الموقع التي منحها
 * المستخدم للموقع في متصفّحه: `navigator.geolocation` كثيراً ما يُرفض فوراً
 * لأن تيليجرام نفسه هو من يملك إذن الموقع من النظام. لذلك يوفّر تيليجرام
 * واجهة خاصة `WebApp.LocationManager` (Bot API 8.0) — وهي الطريق الوحيد
 * لمعرفة موقع المستخدم داخل المصغّر.
 *
 * هذا الملف جسر رفيع لتلك الواجهة: بلا اعتماديات، ولا يرمي أبداً، ويُرجع
 * `null` خارج تيليجرام أو حين لا يمنح المستخدم الإذن — فيكمل النداء الأصلي
 * مساره الطبيعي في المتصفّح العادي.
 */

export interface TgFix { lat: number; lng: number; accuracy: number; }

interface TgLocationData {
    latitude: number;
    longitude: number;
    horizontal_accuracy?: number | null;
}

interface TgLocationManager {
    isInited?: boolean;
    isLocationAvailable?: boolean;
    isAccessGranted?: boolean;
    isAccessRequested?: boolean;
    init?: (cb?: () => void) => void;
    getLocation?: (cb: (loc: TgLocationData | null) => void) => void;
    openSettings?: () => void;
}

const manager = (): TgLocationManager | null => {
    try {
        const lm = (window as any)?.Telegram?.WebApp?.LocationManager;
        return lm && typeof lm.getLocation === 'function' ? lm as TgLocationManager : null;
    } catch {
        return null;
    }
};

/** هل نحن داخل مصغّر تيليجرام يدعم قراءة الموقع؟ */
export const hasTelegramLocation = (): boolean => !!manager();

/**
 * جهّز `LocationManager`. تيليجرام يوجب `init` قبل أي قراءة، والاستدعاء
 * المتكرر آمن. نضع مهلة صلبة لأن ردّ النداء قد لا يأتي في نسخ عميل قديمة.
 */
const initManager = (lm: TgLocationManager, timeoutMs: number): Promise<void> =>
    new Promise<void>(resolve => {
        if (lm.isInited) { resolve(); return; }
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
        const guard = setTimeout(finish, timeoutMs);
        try { lm.init?.(finish); } catch { finish(); }
    });

/**
 * موقع المستخدم من تيليجرام، أو `null`. لا يرمي أبداً.
 *
 * ملاحظة: أول نداء يعرض للمستخدم طلب إذن **من تيليجرام نفسه** (مرة واحدة)؛
 * بعدها يتذكّره تيليجرام، ونحن نتذكّر الإحداثيات في `geoMemory` فلا يتكرر
 * السؤال داخل التطبيق.
 */
export const getTelegramLocation = async (timeoutMs = 10000): Promise<TgFix | null> => {
    const lm = manager();
    if (!lm) return null;
    try {
        await initManager(lm, Math.min(timeoutMs, 4000));
        if (lm.isLocationAvailable === false) return null;
        return await new Promise<TgFix | null>(resolve => {
            let done = false;
            const finish = (v: TgFix | null) => { if (!done) { done = true; clearTimeout(guard); resolve(v); } };
            const guard = setTimeout(() => finish(null), timeoutMs);
            try {
                lm.getLocation!(loc => {
                    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) { finish(null); return; }
                    finish({
                        lat: loc.latitude,
                        lng: loc.longitude,
                        accuracy: Number.isFinite(loc.horizontal_accuracy as number) ? (loc.horizontal_accuracy as number) : 0,
                    });
                });
            } catch { finish(null); }
        });
    } catch {
        return null;
    }
};

/**
 * افتح إعدادات موقع المصغّر داخل تيليجرام — المخرج الوحيد للمستخدم الذي رفض
 * الإذن سابقاً (لا يمكن إعادة سؤاله برمجياً بعد الرفض).
 */
export const openTelegramLocationSettings = (): boolean => {
    const lm = manager();
    if (!lm || typeof lm.openSettings !== 'function') return false;
    try { lm.openSettings(); return true; } catch { return false; }
};
