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
import { setImageCdnHost } from '../utils/thumb';
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
     *  الافتراضات هنا للعرض حتى يصل الصفّ، والقاعدة هي الحَكَم دائماً.
     *  v15.42 — و`selfCloseMinutes` كم دقيقةً بعد الحجز قبل أن يُسمح بالختم
     *  **بلا كود**: «استلمتُ طلبي» للمشتري، واختصارُ التسليم للتاجر. و٠ تعني
     *  «بلا مهلة» — فهي قيمةٌ صالحة لا عطل، ولذلك أرضيّتُها ٠ لا ٠٫٢٥.
     *  🪤 وحقلٌ داخل `booking_holds` لا مفتاحٌ جديد: المفتاحُ الجديد يحتاج
     *  ثلاثةَ مواضع (فرعٌ · جلبٌ · قائمةُ سماح RLS) ونسيانُ الثالث يُعيد
     *  `SELECT` بصفر صفوفٍ لا بخطأ (v14.92 · v15.25). */
    bookingHolds: { pickupHours: number; deliveryHours: number; selfCloseMinutes: number };
    /** v14.17 — نسبة ضريبة **طلبات التجار** من مصدرها الوحيد
     *  (`platform_settings.merchant_vat`). لا تُثبَّت في الكود: كانت مثبّتة
     *  في الموقع ومقروءة من القاعدة في البوتين، فاختلف الرقمان. */
    merchantVatRate: number;
    /** v14.93 — حدود محادثة الحجز. `perBooking = 0` تعني **بلا حدّ** — وهو
     *  الافتراض منذ v14.93: ثلاث رسائل كانت تُقفل المحادثة قبل أن يتّفق
     *  الطرفان على عنوان التوصيل أصلاً. و`perHour` حارس إغراق لكل مرسِل،
     *  وهو الجدار الفعليّ بعد رفع الحدّ الأوّل. */
    chatLimits: { perBooking: number; perHour: number };
    /** v14.95 — توثيق التجّار. `off` بلا أي أثر · `advisory` يُطلب ولا يُمنع ·
     *  `required` يمنع نشر عرضٍ **جديد** لغير الموثّق (والعروض الحيّة لا تُمسّ).
     *  و`vacation` يُنزِّل الأثر من `required` إلى `advisory` بضغطة — فغيابُ
     *  المراجع الوحيد لا يُجمّد تجّاره. */
    verification: { mode: 'off' | 'advisory' | 'required'; slaHours: number; vacation: boolean; showBadge: boolean };
    /** v14.92 — المهلة المعلنة للردّ على الشكاوى. تُقال للمشتري عند الإرسال
     *  وفي «شكواي»، وتُضبط من الإعدادات بلا نشر — فلا يُكتب رقمُ ساعاتٍ
     *  نصّاً في أي مكان (أوّل ضبطٍ يجعله كذباً — درس v14.12). */
    complaintsSlaHours: number;
    /** v14.97 — نافذة الاسترداد الفوري. `hours` **ليست مهلة احتجاز**: تاكي لا
     *  تحتفظ بالمال أصلاً (الدفع يذهب لحساب التاجر مباشرة). هي نافذةُ ضمانٍ
     *  إجرائيّ: خلالها يصل طلبُ الاسترداد التاجرَ فوراً ويُنفَّذ **بلا خطوة
     *  موافقة**. و`merchantButton` مفتاحُ إطفاءٍ فوريّ لزرّ «ردّ المبلغ».
     *  🪤 و`hours = 0` تعني «لا نافذة معلنة» — فلا تُصاغ جملةُ الضمان أصلاً. */
    refundWindow: { hours: number; merchantButton: boolean };
    /** v15.25 — مفتاحُ إظهار بطاقة «اربط مخزونك بنظامك» للتجّار.
     *  🔴 الافتراضُ **مطفأ** بقرار ناصر: الربطُ مبنيٌّ ومقيس، لكنّ سلّة وزد
     *     لا يعملان قبل تسجيل تطبيقَي تاكي لديهما — وبطاقةٌ لا تُنجز شيئاً
     *     أسوأُ من غيابها. ويبقى **ظاهراً لحساب الأدمن** ليجرّبه قبل الفتح.
     *  🪤 وفشلٌ مغلق: غيابُ الصفّ = مخفيّ، لا ظاهر. */
    stockLinkEnabled: boolean;
    /**
     * عناوينُ التواصل المنشورة — **فارغةٌ افتراضاً، فلا تُعرض**.
     * 🔴 ولا تُكتب في الكود: عنوانٌ منشورٌ لا صندوقَ له يستقبله يعني
     *    مستخدماً يشكو إلى الفراغ، ومراجعاً في المتجر يُرسل ولا يُجاب.
     *    والمنفذُ ٢٥ محجوبٌ من جهاز ناصر ومن أوراكل معاً، فلا سبيلَ لي
     *    للتحقّق — فلا أنشرها إلّا بتأكيدٍ صريحٍ منه.
     */
    contactEmails: { info: string; complain: string };
}

/**
 * المفاتيح التي تُجلب عند الإقلاع — **مشتقّةٌ من فروع التطبيق أدناه**.
 *
 * 🔴 واستثناءٌ مقصودٌ من قاعدة «ثلاثة مواضع» (v14.92 · v15.25): مفاتيحُ
 *    **تنبيهات الخادم** (`alert_email` · `alert_channels`) **لا تُضاف هنا
 *    ولا إلى قائمة سماح `platform_settings_select`**. تلك القاعدةُ لمفتاحٍ
 *    **يقرؤه المتصفّح**؛ وهذان يقرؤهما موزّعٌ `SECURITY DEFINER` على القاعدة
 *    وحده (`taki_alert_dispatch`). و`alert_email` يحمل بريدَ ناصر الشخصيّ ⇒
 *    وضعُه في قائمة السماح العامّة **ينشره لكلّ زائرٍ مجهول**.
 *    وشاشاتُ الأدمن تقرأ الجدولَ مباشرةً بفرعِ `taki_admin_perm` القائم في
 *    نفس السياسة — ولذلك `capacity_limits` و`tax_settings` و`vapid_public_key`
 *    في قائمة السماح ولا أثرَ لها هنا. فمن أراد ضبطَ العنوان من اللوحة فلا
 *    يحتاج هذه القائمة، وإضافتُه إليها تسريبٌ لا إصلاح.
 */
export const PLATFORM_SETTING_KEYS = [
    'oauth_google_enabled', 'oauth_apple_enabled',
    'telegram_bot_enabled', 'whatsapp_bot_enabled', 'whatsapp_bot_number',
    'seasonal_theme', 'season_campaign', 'sponsor_layout',
    'banner_autoplay_seconds', 'booking_holds', 'merchant_vat',
    'complaints_sla_hours', 'chat_limits', 'verification', 'refund_window',
    'stock_link_enabled', 'image_cdn_host', 'contact_emails',
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
    // 🔴 مطفأٌ افتراضاً (كان `true`) — قرارُ ناصر ٨ نوفمبر ٢٠٢٦: **لا تيليجرام
    //    ولا واتساب في البداية**، وv15.80 مسحت معرِّفاتهما وأضافت حارساً يرفض
    //    تفعيلَ القناة حتى يُعاد إفصاحُها في سياسة الخصوصيّة
    //    (`BOT_CHANNEL_NOT_DISCLOSED`). والصفُّ الحيُّ `false` فعلاً — لكنّ
    //    الافتراضَ يحكم في حالتين قِيستا في `AppContext`: قبل وصول الجلب،
    //    و**إلى الأبد** إن فشل الجلب (`catch` يُبقي الافتراضات).
    //    فكان زرُّ «اربط تيليجرام» يظهر لقناةٍ لا تردّ — وزرٌّ لا يُنجز شيئاً
    //    أسوأُ من غيابه (نفسُ قاعدة `stockLinkEnabled` في v15.25).
    //    🪤 ويفشل **مغلقاً**: `=== true` في الفرع أدناه، فغيابُ الصفّ = مخفيّ.
    telegramBotEnabled: false,
    whatsappBotEnabled: false,
    whatsappBotNumber: '',
    seasonalTheme,
    seasonCampaign: null,
    sponsorLayout: DEFAULT_SPONSOR_LAYOUT,
    bannerSeconds: 2,
    bookingHolds: { pickupHours: 2, deliveryHours: 6, selfCloseMinutes: 10 },
    merchantVatRate: 15,
    complaintsSlaHours: 24,
    chatLimits: { perBooking: 0, perHour: 120 },
    verification: { mode: 'off', slaHours: 24, vacation: false, showBadge: false },
    refundWindow: { hours: 2, merchantButton: true },
    // 🔴 مطفأ افتراضياً: فشلٌ مغلق — غيابُ الصفّ يعني مخفيّاً لا ظاهراً.
    stockLinkEnabled: false,
    contactEmails: { info: '', complain: '' },
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
                // v15.42 — صفرٌ مقبولٌ هنا (يُعطّل المهلة عمداً)، فـ`exclusiveLo`
                // مُطفأة — عكسَ الساعات حيث صفرٌ مهلةٌ منتهيةٌ قبل أن تبدأ.
                selfCloseMinutes: num((value || {}).self_close_minutes, 10, 0, 1440),
            } });
        case 'merchant_vat':
            // v14.17 — نسبة ضريبة طلبات التجار. للعرض فقط (حاسبة التاجر)؛
            // الفاتورة نفسها تحمل نسبتها مجمّدة من لحظة البيع.
            return prev => ({ ...prev, merchantVatRate: num((value || {}).rate, 15, 0, 100) });
        case 'complaints_sla_hours':
            // v14.92 — كم ساعةً نَعِد بالردّ خلالها على الشكوى.
            return prev => ({ ...prev, complaintsSlaHours: num(value, 24, 1, 720) });
        case 'chat_limits':
            // v14.93 — حدود المحادثة. 0 في per_booking = بلا حدّ، فلا يُقصّ
            // بـGREATEST إلى 1؛ والقاعدة هي الحَكَم دائماً وهذا للعرض فقط.
            return prev => ({ ...prev, chatLimits: {
                perBooking: num((value || {}).per_booking, 0, 0, 1000),
                perHour: num((value || {}).per_hour, 120, 1, 10000),
            } });
        case 'verification': {
            // v14.95 — وضعٌ غير معروف يُقرأ `off`: الافتراضُ الآمن ألّا نمنع أحداً.
            const v: any = value || {};
            const mode = ['off', 'advisory', 'required'].includes(v.mode) ? v.mode : 'off';
            return prev => ({ ...prev, verification: {
                mode, slaHours: num(v.sla_hours, 24, 1, 720),
                vacation: v.vacation === true, showBadge: v.show_badge === true,
            } });
        }
        case 'refund_window': {
            // v14.97 — نافذة الاسترداد المضمون + مفتاح زرّ التاجر. يطابق
            // `taki_refund_policy()` على القاعدة قصّاً وافتراضاً (٠‑٧٢٠ ساعة).
            // 🪤 والصفر مسموحٌ عمداً (`exclusiveLo=false`): «لا نافذة معلنة»
            //    حالةٌ صالحة تُخفي جملة الضمان، لا قيمةٌ فاسدة تُقصّ إلى ساعتين.
            const v: any = value || {};
            return prev => ({ ...prev, refundWindow: {
                hours: num(v.hours, 2, 0, 720),
                merchantButton: typeof v.merchant_button === 'boolean' ? v.merchant_button : true,
            } });
        }
        case 'contact_emails': {
            // 🪤 ويُنظَّف ما يُقرأ: عنوانٌ بصيغةٍ غريبةٍ في الإعداد يُنتج
            //    `mailto:` مكسوراً يفتح برنامجَ بريدٍ بعنوانٍ خاطئ — أسوأُ من
            //    لا عنوان. ما لا يطابق الصيغةَ يُهمَل فتبقى الخانةُ فارغةً.
            const ok = (v: unknown): string => {
                const t = String(v || '').trim();
                return /^[^\s@]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(t) ? t : '';
            };
            const v = (value || {}) as Record<string, unknown>;
            return prev => ({ ...prev, contactEmails: { info: ok(v.info), complain: ok(v.complain) } });
        }
        case 'image_cdn_host':
            // v15.72 — مضيفُ شبكة التوصيل للصور. لا حالةَ واجهةٍ له: القارئُ
            // وحدةٌ نقيّةٌ (`utils/thumb.ts`) تقرؤه عند التصيير.
            // 🪤 والأثرُ هنا لا في AppContext: السقّافةُ رفضت نموَّ ذاك الملفّ
            //    (٣٩٤٨ سطراً) بسطرَي استيرادٍ ونداء — والقاعدةُ «قلّص لا ترفع
            //    السقف». ووضعُه هنا **أصحُّ** أصلاً: تعامُلُ المفتاح كلُّه في
            //    موضعٍ واحد بدل أن يُشطر بين ملفّين ينحرفان.
            // 🪤 وهو الأثرُ الوحيد في هذا المُختصِر، وهو مقبولٌ لأنه يُنادى
            //    مرّةً عند تحميل الإعدادات لا في كلّ تصيير.
            setImageCdnHost(value as unknown as string);
            // و`null` تعني «مفتاحٌ معروفٌ بلا تعديلِ حالة» — لا «مجهول»،
            // وإلّا سقط في `default` وبدا خطأً.
            return null;
        case 'stock_link_enabled':
            // v15.25 — إظهارُ بطاقة ربط المخزون للتجّار، بيد ناصر.
            // 🪤 `=== true` لا `!== false`: البوتُ «يفشل مفتوحاً» لأنه خدمةٌ
            //    قائمة، وهذه ميزةٌ **لم تُؤكَّد بعد** فتفشل **مغلقة**.
            return prev => ({ ...prev, stockLinkEnabled: value === true });
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
