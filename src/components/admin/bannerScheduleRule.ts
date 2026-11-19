/**
 * جدولةُ البانر — القرارُ خالصاً بلا أيّ استيراد (v16.46)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «لا بدّ من وجود تاريخٍ محدَّد في البانر من
 *    وإلى **والساعة**، أو تحطّ أياماً **ويُحسب بالدقيقة** — إلى أسبوع أو
 *    أسبوعين أو شهر أو أيّ عددٍ أضعه — أو تعطيني خيار **أجعلها مفتوحة**».
 *
 * فثلاثةُ أوضاعٍ لا أكثر، ومخرَجُها واحد: `{ startsAt, expiresAt }`.
 *   · `open`  — مفتوحة: لا بداية ولا نهاية (`null` و`null`).
 *   · `days`  — تبدأ الآن وتنتهي بعد N يوماً، **محسوبةً بالدقيقة** من لحظة
 *               الحفظ لا من منتصف الليل. (أسبوع = ٧ · أسبوعان = ١٤ · شهر = ٣٠.)
 *   · `range` — من/إلى بتاريخٍ وساعةٍ صريحين.
 *
 * 🪤 **ولا عمودَ ثالثٌ للمدّة.** «عدد أيام» يُحسب هنا إلى `expires_at` ويُخزَّن
 *    تاريخاً — فلو خُزّنت المدّةُ إلى جانب النهاية لصارا مصدرَي حقيقةٍ
 *    ينحرفان، وأوّلُ تعديلٍ يدويٍّ للنهاية يجعل المدّةَ كذباً.
 *
 * 🪤 و`now` يُمرَّر ولا يُقرأ من الساعة في الجسم: «٧ أيام بالدقيقة» لا تُقاس
 *    في اختبارٍ إن كانت الساعةُ مخبوءةً داخل الدالّة.
 *
 * 🪤 وحقلُ `datetime-local` يعطي نصّاً **بلا منطقة زمنية** (`2026-11-20T17:30`)،
 *    و`new Date()` عليه يقرؤه **بتوقيت الجهاز** — وهو المقصود: ناصرٌ يكتب
 *    ساعةَ الرياض ويراها كما كتبها. ولا يُفسَّر UTC هنا إطلاقاً.
 */

import { arCount, DAYS } from '../../utils/arPlural';

export type BannerScheduleMode = 'open' | 'days' | 'range';

export interface BannerScheduleInput {
    mode: BannerScheduleMode;
    /** لوضع `days` — عددُ الأيام كما كتبه المستخدم. */
    days?: number | string;
    /** لوضع `range` — قيمتا حقلَي `datetime-local`. */
    from?: string;
    to?: string;
}

export interface BannerScheduleResult {
    startsAt: string | null;
    expiresAt: string | null;
    /** سببُ الرفض بالعربية، أو `null` إن صحّت. */
    error: string | null;
}

/** أقصى مدّةٍ تُقبل في وضع «عدد أيام» — سنتان. أبعدُ من ذلك يُكتب بتاريخٍ صريح. */
export const MAX_SCHEDULE_DAYS = 730;

export const computeBannerSchedule = (
    input: BannerScheduleInput,
    now: number,
): BannerScheduleResult => {
    const none: BannerScheduleResult = { startsAt: null, expiresAt: null, error: null };

    if (input.mode === 'open') return none;

    if (input.mode === 'days') {
        const n = Number(String(input.days ?? '').trim());
        if (!Number.isFinite(n) || n <= 0) {
            return { ...none, error: 'اكتب عددَ أيامٍ أكبر من صفر.' };
        }
        if (n > MAX_SCHEDULE_DAYS) {
            return { ...none, error: `أقصى مدّةٍ ${arCount(MAX_SCHEDULE_DAYS, DAYS)} — لأبعدَ من ذلك استعمل «من / إلى».` };
        }
        // 🔴 بالدقيقة لا باليوم: البدايةُ لحظةُ الحفظ، والنهايةُ بعدها بالضبط.
        //    (الكسرُ مقبول: «نصف يوم» = ١٢ ساعة.)
        return {
            startsAt: new Date(now).toISOString(),
            expiresAt: new Date(now + n * 86_400_000).toISOString(),
            error: null,
        };
    }

    // range — من/إلى بالساعة. وكلاهما اختياريّ على حدة:
    //   من فقط  ⇒ يبدأ حينها ولا ينتهي.   إلى فقط ⇒ يبدأ فوراً وينتهي حينها.
    const fromRaw = String(input.from ?? '').trim();
    const toRaw = String(input.to ?? '').trim();
    if (!fromRaw && !toRaw) {
        return { ...none, error: 'حدّد تاريخَ البداية أو النهاية — أو اختر «مفتوحة».' };
    }

    let startsAt: string | null = null;
    let expiresAt: string | null = null;

    if (fromRaw) {
        const t = new Date(fromRaw).getTime();
        if (!Number.isFinite(t)) return { ...none, error: 'تاريخُ البداية غير صالح.' };
        startsAt = new Date(t).toISOString();
    }
    if (toRaw) {
        const t = new Date(toRaw).getTime();
        if (!Number.isFinite(t)) return { ...none, error: 'تاريخُ النهاية غير صالح.' };
        expiresAt = new Date(t).toISOString();
    }

    // 🔴 نهايةٌ قبل البداية = بانرٌ لا يظهر أبداً، **بلا أيّ رسالة**: السياسةُ
    //    تُسقطه بصمت فيظنّ الأدمنُ أن النشرَ فشل. يُرفض هنا قبل الحفظ.
    if (startsAt && expiresAt && new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
        return { ...none, error: 'تاريخُ النهاية يجب أن يكون بعد البداية.' };
    }
    // ونهايةٌ في الماضي: يُحفظ بانرٌ منتهٍ لحظةَ إنشائه.
    if (expiresAt && new Date(expiresAt).getTime() <= now) {
        return { ...none, error: 'تاريخُ النهاية في الماضي — لن يظهر البانر إطلاقاً.' };
    }

    return { startsAt, expiresAt, error: null };
};

/**
 * يقرأ صفَّ بانرٍ قائمٍ فيُعيد الوضعَ الذي يُفتح عليه المحرّر.
 * 🪤 ولا يُخمَّن وضعُ «أيام» من الفرق بين التاريخين: بانرٌ أُنشئ بسبعة أيامٍ
 *    ثمّ عُدّلت نهايتُه يدوياً سيُقرأ «٧ أيام» كذباً. فما له تاريخان صريحان
 *    يُفتح على `range` دائماً — والمستخدمُ يختار «أيام» إن أراد إعادةَ الحساب.
 */
export const scheduleModeOf = (
    row: { starts_at?: string | null; expires_at?: string | null } | null | undefined,
): BannerScheduleMode =>
    (row?.starts_at || row?.expires_at) ? 'range' : 'open';
