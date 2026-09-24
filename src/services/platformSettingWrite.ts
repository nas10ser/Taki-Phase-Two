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

/** تُعيد رسالة خطأ، أو `null` عند نجاحٍ مُثبَت بصفٍّ مُعاد. */
export async function writePlatformSetting(
    key: string, value: unknown, description: string,
): Promise<string | null> {
    const { data, error } = await supabase
        .from('platform_settings')
        .upsert({ key, value, description, updated_at: new Date().toISOString() })
        .select('key');
    if (error) return error.message;
    if (!data || data.length === 0) {
        return 'لم تُحفَظ أي قيمة (صفر صفوف) — قد تمنعك صلاحياتك. حدّث الصفحة وحاول مجدداً.';
    }
    return null;
}
