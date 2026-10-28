/**
 * verificationStatus — لغةُ شاشة المراجعة: حالةٌ واحدة، وسببٌ واحد، وسجلٌّ واحد (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * هذا الملفّ **لا يخترع بيانات**. الحالات السبع وأسباب الرفض الثمانية مقفلةٌ
 * بقيود `CHECK` على `public.store_verifications`، ونصُّها للتاجر مكتوبٌ مرّةً
 * في `verificationRepository`. فكلّ ما هنا هو **ما تحتاجه عينُ المراجع**:
 * لونُ الحالة ورمزها، وما الذي يُطمئن أو يستدعي وقفة.
 *
 * 🪤 ولذلك لا تُنسخ أسبابُ الرفض ولا أسماءُ الوثائق ولا روابط السجلّات هنا —
 *    تُعاد تصديراً من المستودع. نسخةٌ ثانية من نصٍّ يراه التاجر تنحرف بلا صوت
 *    (درس v14.71: عمودان في جدولين وكاتبان لا يعرف أحدهما الآخر)، وأسوأُ
 *    انحرافٍ هنا أن يرى المراجعُ سبباً غيرَ الذي يصل التاجر فعلاً.
 */
import {
    DOC_KINDS, REJECT_REASONS, docKindInfo, rejectReason,
} from '../../../repositories/verificationRepository';
import type {
    DocKind, RejectCode, VerificationStatus,
} from '../../../repositories/verificationRepository';
import type { ArForms } from '../../../utils/arPlural';
import type { Tone } from '../ui';

// ── ما يُعاد تصديره كما هو: مصدرٌ واحد لا نسخة ─────────────────────────────
export { DOC_KINDS, REJECT_REASONS, docKindInfo, rejectReason };
export type { DocKind, RejectCode, VerificationStatus };

// ═══════════════════════════════════════════════════════════════════════════
// الحالة → تسمية + نغمة + رمز
// ═══════════════════════════════════════════════════════════════════════════
export interface StatusMeta {
    label: string;
    /** نغمةٌ من النغمات الخمس وحدها — لا لون خارجها. */
    tone: Tone;
    icon: string;
    /** سطرٌ يقول ماذا تعني هذه الحالة عملياً (يظهر في `title`). */
    hint: string;
}

/**
 * 🪤 النغمة هنا دلالةٌ لا مزاج: **`submitted` وحدها هي التي تطلب فعلاً منك**
 *    فأخذت `warn`. و«سحبه التاجر» و«حلّ محلّه أحدث» ليستا فشلاً فأخذتا
 *    `neutral` — لو صُبغتا بالأحمر لبدا الطابور مليئاً بالمشاكل وهو نظيف.
 */
export const VERIFICATION_STATUS: Record<VerificationStatus, StatusMeta> = {
    submitted:  { label: 'بانتظار المراجعة', tone: 'warn',    icon: '⏳', hint: 'وصل الطلب ولم يُبتّ فيه بعد — هذا وحده ما ينتظر قرارك.' },
    approved:   { label: 'موثّق',            tone: 'ok',      icon: '✅', hint: 'اعتُمد الطلب، والرقم مكتوبٌ في ملفّ المتجر.' },
    rejected:   { label: 'مرفوض',            tone: 'bad',     icon: '❌', hint: 'رُفض بسببٍ مذكور، ووصل التاجرَ نصُّ السبب — وله أن يُرسل من جديد.' },
    withdrawn:  { label: 'سحبه التاجر',      tone: 'neutral', icon: '↩️', hint: 'سحبه صاحبه قبل البتّ — لا إجراء عليك.' },
    expired:    { label: 'انتهت الوثيقة',    tone: 'warn',    icon: '📅', hint: 'تاريخ انتهاء الوثيقة مضى، فسقط التوثيق تلقائياً.' },
    revoked:    { label: 'سحبته الإدارة',    tone: 'bad',     icon: '⛔', hint: 'سُحب التوثيق بعد اعتماده، وأُوقفت عروض المتجر الحيّة.' },
    superseded: { label: 'حلّ محلّه أحدث',   tone: 'neutral', icon: '🗂', hint: 'أُرسل طلبٌ أحدث اعتُمد مكانه — للسجلّ وحده.' },
};

/** حالةٌ لا نعرفها تُعرض باسمها بلا لون — ولا تسقط الشاشة. */
export const statusMeta = (s: VerificationStatus | string | null | undefined): StatusMeta =>
    VERIFICATION_STATUS[s as VerificationStatus]
    ?? { label: String(s || '—'), tone: 'neutral', icon: '•', hint: '' };

/** ترتيب مرشِّحات الطابور — «بانتظار المراجعة» أوّلاً لأنه العمل. */
export const QUEUE_STATUSES: VerificationStatus[] =
    ['submitted', 'approved', 'rejected', 'expired', 'revoked', 'withdrawn'];

// ═══════════════════════════════════════════════════════════════════════════
// السجلّ الرسميّ لكل نوع وثيقة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🔴 الفرق الذي يغيّر القرار **ليس وجودَ خانة بحث بل ما تُثبته**. وقد تغيّر
 *    هذا في v15.29 بعد قياسٍ حيّ على الصفحات نفسها:
 *    • `cr` — «الاستعلام عن بيانات السجل التجاري» في وزارة التجارة حيّةٌ
 *      ومجّانيةٌ وبلا تسجيل دخول، لكنها تبحث **برقم الهوية** لا برقم السجل،
 *      فتُرجع سجلّات ذلك الشخص. وهي بذلك فحصُ **ملكيّة** — أقوى مما كنّا نظنّه.
 *    • `freelance` — كان مكتوباً هنا «لا سجلّ عامّ لها» و**هذا لم يعد صحيحاً**:
 *      «الاستعلام عن متجر إلكتروني موثّق» في المركز السعودي للتنافسية والأعمال
 *      يبحث بخمسة مفاتيح أحدها **رقم وثيقة العمل الحر**، بلا تسجيل دخول.
 *      لكنه يُثبت أن **المتجر موثَّق**، لا أن واقفاً أمامك يملك الوثيقة —
 *      فبقيت `assurance='declared'`.
 * 🪤 ولذلك صار التحذير معلَّقاً على `assurance` لا على `lookup`: خانةُ بحثٍ
 *    موجودة لا تعني إسناداً من سجلّ، ودمجُ المعنيين كان سيُرقّي إقراراً إلى سجلّ.
 */
export interface RegistryMeta {
    /** هل توجد خانةُ بحثٍ عامّة يفتحها المراجع؟ */
    lookup: boolean;
    /** درجةُ الإسناد التي تُسجَّل على القاعدة عند الاعتماد. */
    assurance: 'registry' | 'declared';
    /** ماذا يفعل المراجع بالضبط في تلك الصفحة. */
    howAr: string;
    /** ما الذي **لا** تُثبته تلك الصفحة — يظهر حين يكون الإسناد بإقرار. */
    caveatAr: string;
}

export const REGISTRY: Record<DocKind, RegistryMeta> = {
    business_sa: {
        lookup: true, assurance: 'registry', caveatAr: '',
        howAr: 'افتح «الاستعلام عن متجر إلكتروني موثّق»، ابحث بـ«الرقم الوطني الموحد للمنشأة» أو «اسم المتجر»، وقارن الاسم المسجَّل بما كتبه التاجر.',
    },
    cr: {
        lookup: true, assurance: 'registry', caveatAr: '',
        howAr: 'افتح «الاستعلام عن بيانات السجل التجاري» (وزارة التجارة، مجّانيّ بلا دخول). 🪤 الخانةُ تطلب **رقم الهوية** لا رقم السجل: اطلب من التاجر رقم هويّته، فتظهر سجلّاته — وهذا يُثبت الملكيّة والاسم والحالة معاً.',
    },
    freelance: {
        lookup: true, assurance: 'declared',
        howAr: 'افتح «الاستعلام عن متجر إلكتروني موثّق»، واختر «رقم وثيقة العمل الحر» ثمّ ابحث بالرقم الذي كتبه التاجر.',
        caveatAr: 'هذه الخانة تُثبت أن **المتجر موثَّق**، لا أن صاحب الحساب هو حاملُ الوثيقة — فيُسجَّل «إسناداً بإقرار صاحبه» لا «إسناداً من سجلّ». ولإثبات الشخص نفسه يلزم دخولُ نفاذ، ولا تملكه المنصّة.',
    },
};

/** اسمُ نوع الوثيقة كما يعرفه التاجر نفسه — من كتالوج المستودع لا من نسخةٍ هنا. */
export const kindLabel = (k: DocKind | null | undefined): string => docKindInfo(k)?.ar || '—';

/**
 * رابطُ **المراجع** لا رابط التاجر — `''` لنوعٍ لا نعرفه فيُخفى الزرّ بدل أن
 * يفتح فراغاً. 🪤 و`url` في الكتالوج وجهةٌ أخرى («من أين أجلب الرقم؟»).
 */
export const registryUrl = (k: DocKind | null | undefined): string =>
    docKindInfo(k)?.verifyUrl || '';

export const registryMeta = (k: DocKind | null | undefined): RegistryMeta =>
    REGISTRY[k as DocKind] ?? REGISTRY.freelance;

// ═══════════════════════════════════════════════════════════════════════════
// أدوات صغيرة للشاشة
// ═══════════════════════════════════════════════════════════════════════════

/** «طلب» و«يوم» معدودَين — بمحرّك الجمع نفسه لا بصياغةٍ يدوية (درس v14.92/93). */
export const REQUESTS: ArForms = {
    one: 'طلب واحد', two: 'طلبان', twoGen: 'طلبين', few: 'طلبات', many: 'طلباً',
};

export const DAYS: ArForms = {
    one: 'يوم واحد', two: 'يومان', twoGen: 'يومين', few: 'أيام', many: 'يوماً',
};

export const STORES: ArForms = {
    one: 'متجر واحد', two: 'متجران', twoGen: 'متجرين', few: 'متاجر', many: 'متجراً',
};

export const MERCHANTS: ArForms = {
    one: 'تاجر واحد', two: 'تاجران', twoGen: 'تاجرين', few: 'تجّار', many: 'تاجراً',
};

export const DEALS: ArForms = {
    one: 'عرض واحد', two: 'عرضان', twoGen: 'عرضين', few: 'عروض', many: 'عرضاً',
};

/**
 * 🪤 الوصفُ داخل الصيغة لا بعدها: «١١ تاجراً غير موثّق» و«٣ تجّار غير موثّقين»
 *    يختلفان في **النعت** لا في المعدود وحده. فإلحاقُ صفةٍ ثابتة بمخرج `arCount`
 *    يُخرج «تاجران غير موثّق» — صحيحُ العدد، مكسورُ النعت.
 */
export const UNVERIFIED_MERCHANTS: ArForms = {
    one: 'تاجر واحد غير موثّق', two: 'تاجران غير موثّقين', twoGen: 'تاجرين غير موثّقين',
    few: 'تجّار غير موثّقين', many: 'تاجراً غير موثّق',
};

export const LIVE_DEALS: ArForms = {
    one: 'عرض حيّ واحد', two: 'عرضان حيّان', twoGen: 'عرضين حيّين',
    few: 'عروض حيّة', many: 'عرضاً حيّاً',
};

/**
 * مقارنةُ اسمين تقريبياً — **للعرض وحده**.
 * 🪤 الحَكَم هو القاعدة: `admin_resolve_verification` تردّ `NAME_MISMATCH_UNACKED`
 *    بتطبيعها العربي هي. فلو تساهلت هذه الدالّة، ردَّ الخادمُ الطلبَ وظهر الصندوق؛
 *    ولو تشدّدت، ظهر الإقرار بلا حاجة. وكلاهما مسموح — والخطأ الوحيد غير
 *    المسموح أن تُعتمد الواجهةُ حَكَماً فيُمرَّر اختلافُ اسمٍ بلا إقرار.
 */
const nameKey = (s: string | null | undefined): string =>
    String(s || '')
        .replace(/[ً-ْـ]/g, '')     // تشكيل وتطويل
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')           // ترقيم ومسافات مكرّرة
        .trim()
        .toLowerCase();

export const sameName = (a: string | null | undefined, b: string | null | undefined): boolean => {
    const x = nameKey(a); const y = nameKey(b);
    return !!x && !!y && x === y;
};

/** كم ساعةً مضت على هذا الوقت — رقمٌ خام، صياغتُه على المنادي بـ`arCount`. */
export const hoursSince = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, (Date.now() - t) / 3_600_000);
};

/** تاريخٌ مقروء بأرقام لاتينية — شكلُ لوحة الإدارة نفسه (AdminKit). */
export const fmtDate = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return String(iso); }
};
