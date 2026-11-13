/**
 * chatWindow — هل محادثةُ هذا الطلب مفتوحةٌ الآن؟ (v16.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **توأمُ `taki_chat_window_open` على القاعدة حرفاً بحرف**، والقاعدةُ هي
 *    الحَكَم: `send_booking_message` والمشغّلُ `tr_guard_message_block`
 *    يناديانها. وهذا مرآةٌ لا حارس — وظيفتُه أن يقول الشرطَ **قبل** أن يكتب
 *    أحدٌ رسالةً تُرفض (درسُ v14.08: زرٌّ ظاهرٌ يرفضه الخادمُ يصنع فشلاً بلا
 *    سببٍ مفهوم).
 *
 * 🪤 ولا رقمَ هنا: المدّةُ من `platform_settings.chat_after_close_hours`
 *    يضبطها ناصر من اللوحة، وكلُّ نصٍّ ظاهرٍ يقرؤها حيّةً.
 * 🪤 و**الافتراضُ عند غياب لحظةِ الإغلاق هو الإقفال** — نفسُ اختيار القاعدة،
 *    فصفٌّ ناقصُ البيانات لا تبقى محادثتُه مفتوحةً أبداً.
 */
export interface ChatWindowInput {
    status?: string | null;
    /** لحظةُ الإغلاق بالمللي (أو null). */
    completedAt?: number | null;
    /** `bookings.expiry_time` — مللي ثانية (bigint في القاعدة). */
    expiryTime?: number | null;
}

const CLOSED = ['cancelled', 'completed', 'expired'];

/** لحظةُ انتهاء النافذة بالمللي، أو `null` إن كانت المحادثةُ مفتوحةً بلا حدّ. */
export const chatWindowEndsAt = (b: ChatWindowInput, hours: number): number | null => {
    if (!CLOSED.includes(String(b.status || ''))) return null;   // طلبٌ قائم
    if (!(hours > 0)) return 0;                                  // تُقفل فوراً
    const closedAt = Number(b.completedAt ?? b.expiryTime ?? NaN);
    if (!Number.isFinite(closedAt)) return 0;                    // الافتراضُ الأضيق
    return closedAt + hours * 3600_000;
};

export const isChatOpen = (b: ChatWindowInput, hours: number, nowMs: number = Date.now()): boolean => {
    const ends = chatWindowEndsAt(b, hours);
    return ends === null || ends > nowMs;
};

export default isChatOpen;
