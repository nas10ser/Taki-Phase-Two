/**
 * adminForms — معدوداتُ لوحة الإدارة: صيغةٌ واحدة لكل معدود (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الدرس المدفوع ثلاثَ مرّات («٦ ساعة» v14.92 · «٣ رسالة» v14.93 · «١٠ دقيقة»
 *    v15.50) وهذه رابعته: العربية **خمسُ صيغٍ** لكل معدود، و`${n} ${noun}`
 *    يصحّ في واحدةٍ منها ويُخطئ في أربع. فكلُّ موضعٍ يصنع العبارةَ بيده يُخطئ
 *    في ٨٠٪ من الأعداد — وقِيس في لوحةِ الإدارة **١٤٣ موضعاً** كذلك.
 *
 * والمحرّكُ كان موجوداً وصحيحاً (`utils/arPlural.ts`)، والكتالوجُ كان موجوداً
 * لكنه ساكنٌ **شاشةَ المراجعة** (`verification/verificationStatus.ts`) — فلم
 * تجده الشاشاتُ الأخرى، فاخترعت كلُّ واحدةٍ عبارتَها. فخرج الكتالوجُ إلى هنا،
 * وبقيت تلك الشاشةُ تُعيد تصديرَه فلا ينكسر مستوردٌ واحد.
 *
 * 🪤 ولا تُضاف صيغةٌ «للاحتياط»: الصيغةُ التي لا يناديها موضعٌ تنحرف بصمت.
 * 🪤 والوصفُ يسكن **داخل** الصيغة لا بعدها: «١١ تاجراً غير موثّق» و«٣ تجّار
 *    غير موثّقين» يختلفان في النعت لا في المعدود، فإلحاقُ صفةٍ ثابتة بمخرج
 *    `arCount` يُخرج «تاجران غير موثّق» — صحيحُ العدد مكسورُ النعت.
 */
import { arCount } from '../../../utils/arPlural';
import type { ArForms } from '../../../utils/arPlural';
import { HOURS, MINUTES, DAYS, SECONDS, PIECES, DEALS } from '../../../utils/arPlural';
import { admNum } from './AdminKit';

export type { ArForms };

/**
 * المعدودُ بشكل أرقام اللوحة — فواصلُ آلافٍ وأرقامٌ لاتينية (`admNum`).
 *
 * 🔴 ولهذا الغلافُ لازم: استبدالُ العبارات المصنوعة بـ`arCount` وحدها كان
 *    **يُسقط فاصلةَ الآلاف** فوق ٩٩٩ بلا صوت (`1500 حجزاً` بدل `1,500 حجزاً`)
 *    — أي أن إصلاحَ النحو كان سيُنتج عيباً ثانياً أهدأ منه. والفواصلُ هي
 *    السببُ الذي جعل هذه المواضع تُكتب بالأيدي أصلاً.
 * 🪤 ويبقى `arCount` المباشر لموضعين: ما يُطبع في وثيقةٍ ضريبية (أرقامٌ خام
 *    بلا فواصل) وما يُقاس في اختبار.
 */
export const admCount = (n: number, f: ArForms, genitive = false): string =>
    arCount(n, f, genitive, admNum);

// ═══════════════════════════════════════════════════════════════════════════
// الزمن — ويُعاد تصديرُ ساعةٍ ودقيقةٍ من المحرّك، فلا نسخةَ ثانية
// ═══════════════════════════════════════════════════════════════════════════
export { HOURS, MINUTES, DAYS, SECONDS, PIECES, DEALS };



// ═══════════════════════════════════════════════════════════════════════════
// الناس والمتاجر
// ═══════════════════════════════════════════════════════════════════════════
export const USERS: ArForms = {
    one: 'مستخدم واحد', two: 'مستخدمان', twoGen: 'مستخدمين', few: 'مستخدمين', many: 'مستخدماً',
};

/** 🪤 «فريد» نعتٌ، فهو داخل الصيغة — «٣ مستخدمين فريدين» لا «٣ مستخدمين فريداً». */
export const UNIQUE_USERS: ArForms = {
    one: 'مستخدم واحد فريد', two: 'مستخدمان فريدان', twoGen: 'مستخدمين فريدين',
    few: 'مستخدمين فريدين', many: 'مستخدماً فريداً',
};

export const BUYERS: ArForms = {
    one: 'مشترٍ واحد', two: 'مشتريان', twoGen: 'مشتريين', few: 'مشترين', many: 'مشترياً',
};

export const ACTIVE_BUYERS: ArForms = {
    one: 'مشترٍ واحد نشط', two: 'مشتريان نشطان', twoGen: 'مشتريين نشطين',
    few: 'مشترين نشطين', many: 'مشترياً نشطاً',
};

export const NEW_BUYERS: ArForms = {
    one: 'مشترٍ واحد جديد', two: 'مشتريان جديدان', twoGen: 'مشتريين جديدين',
    few: 'مشترين جُدد', many: 'مشترياً جديداً',
};

export const SELLERS: ArForms = {
    one: 'بائع واحد', two: 'بائعان', twoGen: 'بائعين', few: 'بائعين', many: 'بائعاً',
};

export const MERCHANTS: ArForms = {
    one: 'تاجر واحد', two: 'تاجران', twoGen: 'تاجرين', few: 'تجّار', many: 'تاجراً',
};

export const NEW_MERCHANTS: ArForms = {
    one: 'تاجر واحد جديد', two: 'تاجران جديدان', twoGen: 'تاجرين جديدين',
    few: 'تجّار جُدد', many: 'تاجراً جديداً',
};

export const UNVERIFIED_MERCHANTS: ArForms = {
    one: 'تاجر واحد غير موثّق', two: 'تاجران غير موثّقين', twoGen: 'تاجرين غير موثّقين',
    few: 'تجّار غير موثّقين', many: 'تاجراً غير موثّق',
};

export const SUBSCRIBERS: ArForms = {
    one: 'مشترك واحد', two: 'مشتركان', twoGen: 'مشتركين', few: 'مشتركين', many: 'مشتركاً',
};

export const ACCOUNTS: ArForms = {
    one: 'حساب واحد', two: 'حسابان', twoGen: 'حسابين', few: 'حسابات', many: 'حساباً',
};

export const VISITORS: ArForms = {
    one: 'زائر واحد', two: 'زائران', twoGen: 'زائرين', few: 'زوّار', many: 'زائراً',
};

export const WINNERS: ArForms = {
    one: 'فائز واحد', two: 'فائزان', twoGen: 'فائزين', few: 'فائزين', many: 'فائزاً',
};

export const STORES: ArForms = {
    one: 'متجر واحد', two: 'متجران', twoGen: 'متجرين', few: 'متاجر', many: 'متجراً',
};

/** «لـ٣ متاجر مشتركة» — النعتُ داخل الصيغة، والموضعُ بعد حرف جرّ فيُطلب المجرور. */
export const SUBSCRIBED_STORES: ArForms = {
    one: 'متجر واحد مشترك', two: 'متجران مشتركان', twoGen: 'متجرين مشتركين',
    few: 'متاجر مشتركة', many: 'متجراً مشتركاً',
};

export const SUSPENDED_STORES: ArForms = {
    one: 'متجر واحد موقوف إدارياً', two: 'متجران موقوفان إدارياً',
    twoGen: 'متجرين موقوفين إدارياً', few: 'متاجر موقوفة إدارياً',
    many: 'متجراً موقوفاً إدارياً',
};

// ═══════════════════════════════════════════════════════════════════════════
// العروض والحجوزات والمال
// ═══════════════════════════════════════════════════════════════════════════

export const LIVE_DEALS: ArForms = {
    one: 'عرض حيّ واحد', two: 'عرضان حيّان', twoGen: 'عرضين حيّين',
    few: 'عروض حيّة', many: 'عرضاً حيّاً',
};

export const ACTIVE_DEALS: ArForms = {
    one: 'عرض نشط واحد', two: 'عرضان نشطان', twoGen: 'عرضين نشطين',
    few: 'عروض نشطة', many: 'عرضاً نشطاً',
};

export const BOOKINGS: ArForms = {
    one: 'حجز واحد', two: 'حجزان', twoGen: 'حجزين', few: 'حجوزات', many: 'حجزاً',
};

/** «عملية بحث» معدودٌ مركّب — والمثنّى يُضاف فيه إلى المميّز («عمليتا بحث»). */
export const SEARCHES: ArForms = {
    one: 'عملية بحث واحدة', two: 'عمليتا بحث', twoGen: 'عمليتي بحث',
    few: 'عمليات بحث', many: 'عملية بحث',
};

/**
 * 🪤 حذفُ المعدود مقصود: هاتان تُكتبان في سطرِ «نطاق» تحت رقمِ الحجوزات
 *    («حجوزات ١٢٠ · ٨٠ مكتملة · ٤٠ ملغاة»)، فإعادةُ كلمة «حجز» فيه تكرار.
 *    والنعتُ وحده معدودٌ نحوياً فله صيغُه الخمس كاملة.
 */
export const COMPLETED: ArForms = {
    one: 'مكتمل واحد', two: 'مكتملان', twoGen: 'مكتملين', few: 'مكتملة', many: 'مكتملاً',
};

export const CANCELLED: ArForms = {
    one: 'ملغى واحد', two: 'ملغيان', twoGen: 'ملغيين', few: 'ملغاة', many: 'ملغى',
};


export const VIEWS: ArForms = {
    one: 'مشاهدة واحدة', two: 'مشاهدتان', twoGen: 'مشاهدتين', few: 'مشاهدات', many: 'مشاهدة',
};

export const INVOICES: ArForms = {
    one: 'فاتورة واحدة', two: 'فاتورتان', twoGen: 'فاتورتين', few: 'فواتير', many: 'فاتورة',
};

export const PAYMENTS: ArForms = {
    one: 'دفعة واحدة', two: 'دفعتان', twoGen: 'دفعتين', few: 'دفعات', many: 'دفعة',
};

export const SUBSCRIPTIONS: ArForms = {
    one: 'اشتراك واحد', two: 'اشتراكان', twoGen: 'اشتراكين', few: 'اشتراكات', many: 'اشتراكاً',
};

export const NEW_SUBSCRIPTIONS: ArForms = {
    one: 'اشتراك جديد واحد', two: 'اشتراكان جديدان', twoGen: 'اشتراكين جديدين',
    few: 'اشتراكات جديدة', many: 'اشتراكاً جديداً',
};

export const GATEWAYS: ArForms = {
    one: 'بوّابة واحدة', two: 'بوّابتان', twoGen: 'بوّابتين', few: 'بوّابات', many: 'بوّابة',
};

// ═══════════════════════════════════════════════════════════════════════════
// الرقابة والشكاوى
// ═══════════════════════════════════════════════════════════════════════════
export const REPORTS: ArForms = {
    one: 'بلاغ واحد', two: 'بلاغان', twoGen: 'بلاغين', few: 'بلاغات', many: 'بلاغاً',
};

export const OPEN_REPORTS: ArForms = {
    one: 'بلاغ واحد مفتوح', two: 'بلاغان مفتوحان', twoGen: 'بلاغين مفتوحين',
    few: 'بلاغات مفتوحة', many: 'بلاغاً مفتوحاً',
};

export const FILED_REPORTS: ArForms = {
    one: 'بلاغ واحد مُقدّم', two: 'بلاغان مُقدّمان', twoGen: 'بلاغين مُقدّمين',
    few: 'بلاغات مُقدّمة', many: 'بلاغاً مُقدّماً',
};

export const RECEIVED_REPORTS: ArForms = {
    one: 'بلاغ واحد مستلَم', two: 'بلاغان مستلَمان', twoGen: 'بلاغين مستلَمين',
    few: 'بلاغات مستلَمة', many: 'بلاغاً مستلَماً',
};

export const COMPLAINTS: ArForms = {
    one: 'شكوى واحدة', two: 'شكويان', twoGen: 'شكويين', few: 'شكاوى', many: 'شكوى',
};

export const OPEN_COMPLAINTS: ArForms = {
    one: 'شكوى واحدة مفتوحة', two: 'شكويان مفتوحتان', twoGen: 'شكويين مفتوحتين',
    few: 'شكاوى مفتوحة', many: 'شكوى مفتوحة',
};

export const REPLIES: ArForms = {
    one: 'ردّ واحد', two: 'ردّان', twoGen: 'ردّين', few: 'ردود', many: 'ردّاً',
};

export const WARNINGS: ArForms = {
    one: 'إنذار واحد', two: 'إنذاران', twoGen: 'إنذارين', few: 'إنذارات', many: 'إنذاراً',
};

export const CANCELLATIONS: ArForms = {
    one: 'إلغاء واحد', two: 'إلغاءان', twoGen: 'إلغاءين', few: 'إلغاءات', many: 'إلغاءً',
};

export const SESSIONS: ArForms = {
    one: 'جلسة واحدة', two: 'جلستان', twoGen: 'جلستين', few: 'جلسات', many: 'جلسة',
};

export const OPEN_SESSIONS: ArForms = {
    one: 'جلسة واحدة مفتوحة', two: 'جلستان مفتوحتان', twoGen: 'جلستين مفتوحتين',
    few: 'جلسات مفتوحة', many: 'جلسة مفتوحة',
};

export const REPORTERS: ArForms = {
    one: 'مبلِّغ واحد مختلف', two: 'مبلِّغان مختلفان', twoGen: 'مبلِّغين مختلفين',
    few: 'مبلِّغين مختلفين', many: 'مبلِّغاً مختلفاً',
};

export const LINKED_GATEWAYS: ArForms = {
    one: 'بوّابة واحدة مرتبطة', two: 'بوّابتان مرتبطتان', twoGen: 'بوّابتين مرتبطتين',
    few: 'بوّابات مرتبطة', many: 'بوّابة مرتبطة',
};

export const WORDS: ArForms = {
    one: 'كلمة واحدة', two: 'كلمتان', twoGen: 'كلمتين', few: 'كلمات', many: 'كلمة',
};

// ═══════════════════════════════════════════════════════════════════════════
// الطابور والمحتوى والقياس
// ═══════════════════════════════════════════════════════════════════════════
export const REQUESTS: ArForms = {
    one: 'طلب واحد', two: 'طلبان', twoGen: 'طلبين', few: 'طلبات', many: 'طلباً',
};

export const ROWS: ArForms = {
    one: 'صفّ واحد', two: 'صفّان', twoGen: 'صفّين', few: 'صفوف', many: 'صفّاً',
};

export const OPERATIONS: ArForms = {
    one: 'عملية واحدة', two: 'عمليتان', twoGen: 'عمليتين', few: 'عمليات', many: 'عملية',
};

export const ENTRIES: ArForms = {
    one: 'مشاركة واحدة', two: 'مشاركتان', twoGen: 'مشاركتين', few: 'مشاركات', many: 'مشاركة',
};

export const CITIES: ArForms = {
    one: 'مدينة واحدة', two: 'مدينتان', twoGen: 'مدينتين', few: 'مدن', many: 'مدينة',
};

export const CATEGORIES: ArForms = {
    one: 'قسم واحد', two: 'قسمان', twoGen: 'قسمين', few: 'أقسام', many: 'قسماً',
};

export const IMAGES: ArForms = {
    one: 'صورة واحدة', two: 'صورتان', twoGen: 'صورتين', few: 'صور', many: 'صورة',
};

export const BANNERS: ArForms = {
    one: 'بانر واحد', two: 'بانران', twoGen: 'بانرين', few: 'بانرات', many: 'بانراً',
};

export const EMAILS: ArForms = {
    one: 'بريد واحد', two: 'بريدان', twoGen: 'بريدين', few: 'رسائل بريد', many: 'بريداً',
};

export const DIAGNOSES: ArForms = {
    one: 'تشخيص واحد', two: 'تشخيصان', twoGen: 'تشخيصين', few: 'تشخيصات', many: 'تشخيصاً',
};

export const POINTS: ArForms = {
    one: 'نقطة واحدة', two: 'نقطتان', twoGen: 'نقطتين', few: 'نقاط', many: 'نقطة',
};

export const EVENTS: ArForms = {
    one: 'حدث واحد', two: 'حدثان', twoGen: 'حدثين', few: 'أحداث', many: 'حدثاً',
};

/**
 * نعوتٌ تُكتب وحدها في الشارات («٣ معروضة من ٢٠») — مذكّرٌ للمتاجر والبلاغات
 * والبانرات، ومؤنّثٌ للمشاركات والشكاوى. 🪤 وجمعُ غير العاقل يُنعَت بالمفرد
 * المؤنّث، فصيغةُ `few` فيهما واحدة.
 */
export const ACTIVE_M: ArForms = {
    one: 'نشط واحد', two: 'نشطان', twoGen: 'نشطين', few: 'نشطة', many: 'نشطاً',
};

export const SHOWN_M: ArForms = {
    one: 'معروض واحد', two: 'معروضان', twoGen: 'معروضين', few: 'معروضة', many: 'معروضاً',
};

export const SHOWN_F: ArForms = {
    one: 'معروضة واحدة', two: 'معروضتان', twoGen: 'معروضتين', few: 'معروضة', many: 'معروضة',
};

export const OPEN_F: ArForms = {
    one: 'مفتوحة واحدة', two: 'مفتوحتان', twoGen: 'مفتوحتين', few: 'مفتوحة', many: 'مفتوحة',
};
