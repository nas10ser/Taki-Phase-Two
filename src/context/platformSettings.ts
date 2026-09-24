/**
 * platformSettings — إعدادات المنصّة: نوعُها وافتراضاتُها وقارئُها (v14.92)
 * ═══════════════════════════════════════════════════════════════════════════
 * كانت هذه كلها داخل `AppContext.tsx` — والسقّافة (`check-file-size.js`) تمنع
 * نموّه سطراً واحداً عمداً: ملفٌّ لا يُقرأ في جلسةٍ واحدة يصير التعديل فيه
 * تخميناً. فحين احتاج إعدادُ مهلة الشكاوى مكاناً، كان الصواب **تقليصه** لا
 * رفع سقفه.
 *
 * وهنا مصدرٌ واحد لثلاثة أشياء كانت متفرّقة ومعرّضة للانحراف:
 *   • النوع (كان مكتوباً مرّتين: في واجهة السياق وفي `useState`)،
 *   • الافتراضات،
 *   • **وقائمة المفاتيح المجلوبة** — 🪤 وقد انحرفت فعلاً: `complaints_sla_hours`
 *     كان له فرعُ تطبيقٍ ولم يكن في قائمة الجلب الأوّل، فما كان يصل إلا إن
 *     غيّره المدير أثناء فتح الصفحة. الآن القائمة تُشتقّ من نفس الجدول.
 */
import { SeasonCampaign, parseSeasonCampaign } from '../data/seasons';
import { SponsorLayout, DEFAULT_SPONSOR_LAYOUT, parseSponsorLayout } from '../utils/helpers';

export interface PlatformSettings {
    oauthGoogleEnabled: boolean;
    oauthAppleEnabled: boolean;
    telegramBotEnabled: boolean;
    whatsappBotEnabled: boolean;
    whatsappBotNumber: string;
    seasonalTheme: string;
    seasonCampaign: SeasonCampaign | null;
    sponsorLayout: SponsorLayout;
    bannerSeconds: number;
    /** v14.10 — مهلة الحجز بالساعات، مصدرها الوحيد صفّ `booking_holds`.
     *  الافتراضات هنا للعرض حتى يصل الصفّ، والقاعدة هي الحَكَم دائماً. */
    bookingHolds: { pickupHours: number; deliveryHours: number };
    /** v14.17 — نسبة ضريبة **طلبات التجار** من مصدرها الوحيد
     *  (`platform_settings.merchant_vat`). لا تُثبَّت في الكود: كانت مثبّتة
     *  في الموقع ومقروءة من القاعدة في البوتين، فاختلف الرقمان. */
    merchantVatRate: number;
    /** v14.92 — المهلة المعلنة للردّ على الشكاوى. تُقال للمشتري عند الإرسال
     *  وفي «شكاواي»، وتُضبط من الإعدادات بلا نشر — فلا يُكتب رقمُ ساعاتٍ
     *  نصّاً في أي مكان (أوّل ضبطٍ يجعله كذباً — درس v14.12). */
    complaintsSlaHours: number;
}

/** المفاتيح التي تُجلب عند الإقلاع — **مشتقّةٌ من فروع التطبيق أدناه**. */
export const PLATFORM_SETTING_KEYS = [
    'oauth_google_enabled', 'oauth_apple_enabled',
    'telegram_bot_enabled', 'whatsapp_bot_enabled', 'whatsapp_bot_number',
    'seasonal_theme', 'season_campaign', 'sponsor_layout',
    'banner_autoplay_seconds', 'booking_holds', 'merchant_vat',
    'complaints_sla_hours',
];

/**
 * رقمٌ ضمن مجال، وإلا الافتراضي. القيمة قد تصل نصّاً من jsonb.
 * 🪤 `exclusiveLo` ليست زينة: مهلة الحجز كانت `n > 0` لا `n >= 0`، وصفرُ ساعةٍ
 *    مهلةٌ منتهية قبل أن تبدأ.
 * 🪤 وتُقرأ بـ`parseFloat` لا `Number()`: `Number(null)` صفرٌ صالح — فنسبة
 *    ضريبةٍ `null` كانت ستصير **٠٪** بدل الافتراضي ١٥٪ (خطأٌ يصمت).
 */
const num = (x: any, d: number, lo: number, hi: number, exclusiveLo = false): number => {
    const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''));
    if (!Number.isFinite(n) || n > hi) return d;
    return (exclusiveLo ? n > lo : n >= lo) ? n : d;
};

export const defaultPlatformSettings = (seasonalTheme = ''): PlatformSettings => ({
    oauthGoogleEnabled: false,
    oauthAppleEnabled: false,
    telegramBotEnabled: true,
    whatsappBotEnabled: false,
    whatsappBotNumber: '',
    seasonalTheme,
    seasonCampaign: null,
    sponsorLayout: DEFAULT_SPONSOR_LAYOUT,
    bannerSeconds: 2,
    bookingHolds: { pickupHours: 2, deliveryHours: 6 },
    merchantVatRate: 15,
    complaintsSlaHours: 24,
});

/**
 * يُرجع التعديل الواجب على الحالة لمفتاحٍ واحد، أو `null` لمفتاحٍ لا يعنينا.
 * دالةٌ صافية عمداً: أثر الموسم على `<html>` يبقى عند المنادي لأنه DOM.
 */
export const applyPlatformSetting = (
    key: string, value: any,
): ((prev: PlatformSettings) => PlatformSettings) | null => {
    switch (key) {
        case 'oauth_google_enabled':
            return prev => ({ ...prev, oauthGoogleEnabled: value === true });
        case 'oauth_apple_enabled':
            return prev => ({ ...prev, oauthAppleEnabled: value === true });
        case 'telegram_bot_enabled':
            return prev => ({ ...prev, telegramBotEnabled: value === true });
        case 'whatsapp_bot_enabled':
            return prev => ({ ...prev, whatsappBotEnabled: value === true });
        case 'whatsapp_bot_number':
            // رقم واتساب الرسمي (أرقام فقط، مثل "9665…"). يبني رابط wa.me،
            // وفراغُه يُخفي الزرّ بدل أن يفتح رابطاً معطوباً (درس v14.77).
            return prev => ({ ...prev, whatsappBotNumber: typeof value === 'string' ? value.replace(/\D/g, '') : '' });
        case 'seasonal_theme':
            // v12.44 — «هوية المواسم»: يختار المالك موسماً فتتبدّل كل الصفحات
            // المفتوحة لحظياً. الجلد نفسه CSS خالص مفتاحه <html data-season>.
            return prev => ({ ...prev, seasonalTheme: typeof value === 'string' ? value : '' });
        case 'season_campaign':
            // v12.48 — «حملة الموسم»: نوافذ التجار/العامة لصفحة عروض الموسم.
            return prev => ({ ...prev, seasonCampaign: parseSeasonCampaign(value) });
        case 'sponsor_layout':
            // v12.50 — «تحكم ترتيب الرعاة»: نمط ظهور الإعلانات في القوائم.
            return prev => ({ ...prev, sponsorLayout: parseSponsorLayout(value) });
        case 'booking_holds':
            // v14.10 — مهلة الحجز: استلام · توصيل. الرقم الوحيد في المنصّة كلها،
            // تقرؤه الواجهة والقاعدة والبوتان من هنا، ويسري تغييره بلا نشر.
            return prev => ({ ...prev, bookingHolds: {
                pickupHours: num((value || {}).pickup_hours, 2, 0, 8760, true),
                deliveryHours: num((value || {}).delivery_hours, 6, 0, 8760, true),
            } });
        case 'merchant_vat':
            // v14.17 — نسبة ضريبة طلبات التجار. للعرض فقط (حاسبة التاجر)؛
            // الفاتورة نفسها تحمل نسبتها مجمّدة من لحظة البيع.
            return prev => ({ ...prev, merchantVatRate: num((value || {}).rate, 15, 0, 100) });
        case 'complaints_sla_hours':
            // v14.92 — كم ساعةً نَعِد بالردّ خلالها على الشكوى.
            return prev => ({ ...prev, complaintsSlaHours: num(value, 24, 1, 720) });
        case 'banner_autoplay_seconds':
            // v12.71 — سرعة تنقّل بانر الرئيسية بيد المدير (الافتراضي ثانيتان).
            return prev => ({ ...prev, bannerSeconds: num(value, 2, 1, 120) });
        default:
            return null;
    }
};

/** أثر الموسم على `<html>` وعلى الذاكرة المحلّية — DOM لا حالة. */
export const applySeasonSkin = (value: any): void => {
    const seasonId = typeof value === 'string' ? value : '';
    try {
        if (seasonId) {
            document.documentElement.setAttribute('data-season', seasonId);
            localStorage.setItem('TAKI_SEASON', seasonId);
        } else {
            document.documentElement.removeAttribute('data-season');
            localStorage.removeItem('TAKI_SEASON');
        }
    } catch { /* localStorage may be blocked (private mode) */ }
};
