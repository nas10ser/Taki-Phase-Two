/**
 * platformSettingWrite — كتابةُ إعدادٍ تُثبت نفسها (v14.92)
 * ═══════════════════════════════════════════════════════════════════════════
 * كانت داخل `AdminTools.tsx` وحده، فلمّا احتاجتها شاشةٌ ثانية كان البديلُ
 * نسخَها — وأي نسخةٍ ثانية تنحرف. خرجت إلى هنا مصدراً واحداً.
 *
 * 🪤 `upsert` لأن الصفّ قد لا يكون موجوداً (هذا بالضبط ما كان يُسقط مفتاح
 *    بوابة الدفع)، و`.select()` لأن **صفر صفوفٍ بلا خطأ** هو شكل الرفض الصامت
 *    الذي تعيده RLS: بدونها يقول الزرّ «✅ حُفظ» ولا يُحفظ شيء.
 */
import { supabase } from './supabaseClient';

/**
 * 🔴 v16.56 — رموزُ حرّاس القاعدة تُترجَم هنا، **في المكان الواحد الذي تمرّ
 *    به كلُّ كتابةِ إعداد**. وبلاغُ ناصر (٢٤ نوفمبر) هو السبب: ظهر له
 *    `BOT_CHANNEL_NOT_DISCLOSED` حرفاً إنجليزياً في نافذةٍ بزرّ «موافق» — بلا
 *    سببٍ ولا خطوةٍ تالية. والحارسُ يحمل الشرحَ في `DETAIL`، لكنّ PostgREST
 *    لا يُمرّره إلى `error.message` فلا يصل الشاشةَ أبداً.
 *
 * 🪤 ويُطابَق **بالاحتواء** لا بالمساواة: رسالةُ PostgREST قد تلفّ الرمزَ
 *    بنصٍّ آخر، والمساواةُ تُسقط المطابقةَ فتعود الرسالةُ خاماً.
 */
const GUARD_CODES: { code: string; text: string }[] = [
    {
        code: 'BOT_CHANNEL_NOT_DISCLOSED',
        text: 'لا يمكن تشغيل البوت الآن: سياسةُ الخصوصية لا تذكر قناتَي تيليجرام وواتساب '
            + '(حُذفتا منها بقرارك في ٨ نوفمبر). وتشغيلُ القناة يعني معالجةَ بياناتٍ '
            + 'شخصيّةٍ عبرها — فلا يصحّ قبل الإفصاح.\n\n'
            + 'أخبِرني أن تُعيد الإفصاح، فأُعيده في سياسة الخصوصية وأرفع إصدارَ '
            + 'الوثائق وأفتح القفل، ثمّ يعمل الزرّ.',
    },
];

/** تُعيد رسالة خطأ، أو `null` عند نجاحٍ مُثبَت بصفٍّ مُعاد. */
export async function writePlatformSetting(
    key: string, value: unknown, description: string,
): Promise<string | null> {
    const { data, error } = await supabase
        .from('platform_settings')
        .upsert({ key, value, description, updated_at: new Date().toISOString() })
        .select('key');
    if (error) {
        const raw = String(error.message || '') + ' ' + String((error as any).hint || '')
            + ' ' + String((error as any).details || '');
        const hit = GUARD_CODES.find(g => raw.includes(g.code));
        return hit ? hit.text : error.message;
    }
    if (!data || data.length === 0) {
        return 'لم تُحفَظ أي قيمة (صفر صفوف) — قد تمنعك صلاحياتك. حدّث الصفحة وحاول مجدداً.';
    }
    return null;
}
