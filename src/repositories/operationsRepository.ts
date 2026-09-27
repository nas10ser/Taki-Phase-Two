/**
 * operationsRepository — سجلّ العمليات في لوحة الإدارة (v14.99)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ما كان: كل حجزٍ وكل إتمام بيعٍ وكل إلغاء كان يُدخل إشعاراً **لكل حساب
 *    أدمن** في جرس الإشعارات — قِيس: ٢٤٠ إشعاراً إدارياً من نوع `booking`
 *    على ٨٩ حجزاً. فصار الجرسُ لا يُقرأ، وما يحتاج قراراً حقيقياً (شكوى أو
 *    بلاغ) يغرق بين إعلاناتٍ لا تحتاج فعلاً.
 *
 * ما صار: الحدثُ يُكتب سطراً واحداً في `public.activity_log` بـ
 * `entity_id = barcode` — وهو **رقم المرجع** الذي يطلبه ناصر: الرقم نفسه
 * الذي يقوله المشتري عند الاستلام، وتحمله الفاتورة، ويقرؤه ماسحُ التاجر.
 *
 * 🪤 ولا تُخترع هنا تسمية: أسماءُ الأفعال (`booking_created`…) تكتبها
 *    القاعدةُ، والعربيّةُ لها في `ACTION_META` أدناه — مكانٌ واحد يقرؤه كل
 *    مَن يعرض عمليةً، فلا ينحرف اسمٌ بين شاشةٍ وأخرى (درس v14.89).
 *
 * 🪤 والترقيم بمؤشّرٍ **مركَّب** `(created_at, id)`: حدثان في المعاملة نفسها
 *    يحملان `now()` نفسه بالضبط، فمؤشّرٌ زمنيّ صرف يُسقط الثاني بين صفحتين
 *    بلا أي أثر (قاعدة «لا يسقط شيء»، v14.28).
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';
import type { Tone } from '../components/admin/ui';

// ═══════════════════════════════════════════════════════════════════════════
// الأنواع
// ═══════════════════════════════════════════════════════════════════════════

export interface OperationRow {
    id: number;
    /** وقت الحدث بصيغة ISO كما كتبته القاعدة. */
    at: string;
    /** اسم الفعل كما تكتبه القاعدة — لا يُترجَم هنا بل في `ACTION_META`. */
    action: string;
    entityType: string | null;
    /** رقم المرجع (`bookings.barcode`) — هو رقم الطلب نفسه. */
    code: string | null;
    actorId: string | null;
    actorType: string | null;
    actorName: string | null;
    storeId: string | null;
    storeName: string | null;
    buyerId: string | null;
    buyerName: string | null;
    dealId: string | null;
    quantity: number | null;
    amount: number | null;
    event: string | null;
    meta: Record<string, unknown>;
}

/** عدّادٌ لكل فعلٍ موجودٍ فعلاً في السجلّ — فالمرشِّحات لا تعرض فعلاً لا وجود له. */
export interface OperationActionCount { action: string; n: number }

export interface OperationStats {
    /** عمليات اليوم بتوقيت الرياض (الخادم على `+03:00` لا UTC). */
    today: number;
    /** آخر سبعة أيام متدحرجة، بما فيها اليوم. */
    week: number;
    total: number;
    /** أحدث رقم مرجعٍ دخل السجلّ — «آخر ما جرى» في سطرٍ واحد. */
    latestCode: string | null;
    latestAt: string | null;
    actions: OperationActionCount[];
}

export interface OperationsPage {
    ok: boolean;
    rows?: OperationRow[];
    /** تصل مع الصفحة الأولى وحدها — الأرقام لا تُعاد حسابها مع كل «المزيد». */
    stats?: OperationStats | null;
    nextCursor?: string | null;
    nextCursorId?: number | null;
    msg?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// كتالوج الأفعال — عربيّةُ كل فعلٍ ونغمتُه
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🪤 السجلّ يحمل أفعالاً أقدم من هذه الشاشة (مفاتيح البوّابات، الإنذارات،
 *    حذف رسالة…). فالكتالوج **لا يُستعمل مرشِّح سماح**: ما ليس فيه يُعرض
 *    باسمه الخام لا يُخفى — وإلا اختفت عملياتٌ حقيقية بلا أن يقول أحد لماذا.
 */
export const ACTION_META: Record<string, { ar: string; icon: string; tone: Tone }> = {
    booking_created:   { ar: 'طلب جديد',        icon: '🛒', tone: 'info' },
    booking_completed: { ar: 'اكتمل الطلب',     icon: '✅', tone: 'ok' },
    booking_cancelled: { ar: 'أُلغي الطلب',     icon: '↩️', tone: 'warn' },
    booking_expired:   { ar: 'انتهت المهلة',    icon: '⏰', tone: 'neutral' },
    // v14.97 — يكتبها مسارُ الردّ الفوريّ في `merchant-pay`. وبدونها كانت
    // تُعرض بنصّها الإنجليزيّ الخام وبلونٍ محايد — وأخطرُها تحديداً.
    refund_succeeded:  { ar: 'رُدّ المبلغ',      icon: '💸', tone: 'ok' },
    refund_declined:   { ar: 'رفضت البوّابة الردّ', icon: '⛔', tone: 'warn' },
    // 🔴 هذه وحدها تعني «قد يكون المال خرج ولا نعلم»: الطلب عالقٌ على
    //    `claiming` ولا يفكّه شيءٌ من تلقاء نفسه — وهذا السطرُ هو الموضعُ
    //    الوحيد الذي يراه فيه أحد. فيُعرض بأشدّ نبرة.
    refund_outcome_unknown: { ar: 'ردٌّ بنتيجة غير معلومة — يحتاج مراجعة', icon: '⚠️', tone: 'bad' },
};

/** الأفعال الأربعة التي تكتبها دورةُ الحجز — ترتيبُ المرشِّحات يتبعه. */
export const BOOKING_ACTIONS = [
    'booking_created', 'booking_completed', 'booking_cancelled', 'booking_expired',
] as const;

export const actionMeta = (action: string): { ar: string; icon: string; tone: Tone } =>
    ACTION_META[action] || { ar: action, icon: '•', tone: 'neutral' };

/** من قام بالعملية — كلمةٌ واحدة للعرض. */
export const ACTOR_AR: Record<string, string> = {
    buyer: 'المشتري', seller: 'التاجر', admin: 'الإدارة', system: 'النظام',
};

// ═══════════════════════════════════════════════════════════════════════════
// المحوّلات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🪤 `Number(null)` صفرٌ صالح و`Number('')` كذلك — فمبلغٌ غائب كان سيُعرض
 *    «٠ ر.س»، وهي جملةٌ تقول شيئاً غير صحيح عن طلبٍ له ثمن (درس v14.92).
 */
const numOrNull = (x: unknown): number | null => {
    if (x === null || x === undefined || x === '') return null;
    const n = typeof x === 'number' ? x : parseFloat(String(x));
    return Number.isFinite(n) ? n : null;
};

const str = (x: unknown): string | null => {
    if (x === null || x === undefined) return null;
    const s = String(x).trim();
    return s === '' ? null : s;
};

const mapRow = (r: any): OperationRow => ({
    id: Number(r?.id) || 0,
    at: String(r?.at || ''),
    action: String(r?.action || ''),
    entityType: str(r?.entity_type),
    code: str(r?.code),
    actorId: str(r?.actor_id),
    actorType: str(r?.actor_type),
    actorName: str(r?.actor_name),
    storeId: str(r?.store_id),
    storeName: str(r?.store_name),
    buyerId: str(r?.buyer_id),
    buyerName: str(r?.buyer_name),
    dealId: str(r?.deal_id),
    quantity: numOrNull(r?.quantity),
    amount: numOrNull(r?.amount),
    event: str(r?.event),
    meta: (r?.meta && typeof r.meta === 'object') ? r.meta : {},
});

const mapStats = (s: any): OperationStats => ({
    today: Number(s?.today) || 0,
    week: Number(s?.week) || 0,
    total: Number(s?.total) || 0,
    latestCode: str(s?.latest_code),
    latestAt: str(s?.latest_at),
    actions: (Array.isArray(s?.actions) ? s.actions : [])
        .map((a: any) => ({ action: String(a?.action || ''), n: Number(a?.n) || 0 }))
        .filter((a: OperationActionCount) => a.action !== ''),
});

// ═══════════════════════════════════════════════════════════════════════════

export const operationsRepository = {
    /**
     * صفحةٌ من سجلّ العمليات.
     * `cursor`/`cursorId` من الصفحة السابقة — مرّرهما معاً أو لا تمرّر أيّاً
     * منهما؛ وتمريرُ الزمن وحده يسقط صفّاً يشاركه اللحظة نفسها.
     *
     * 🪤 وثلاثُ حالاتٍ لا اثنتان (درس `storePolicies` في v14.18):
     *   • `ok:false`               — لم يُجب الخادم، فلا يُقال «لا عمليات».
     *   • `ok:true, rows:[]`       — أجاب ولا شيء يطابق.
     *   • `ok:true, rows:[…]`      — الصفحة.
     */
    list: async (p: {
        limit?: number;
        cursor?: string | null;
        cursorId?: number | null;
        action?: string | null;
        q?: string | null;
    } = {}): Promise<OperationsPage> => {
        const { data, error } = await supabase.rpc('admin_operations_log', {
            p_limit: p.limit ?? 30,
            p_cursor: p.cursor ?? null,
            p_action: p.action || null,
            p_q: p.q?.trim() || null,
            p_cursor_id: p.cursorId ?? null,
        });
        if (error) {
            logger.warn('admin_operations_log:', error.message);
            return { ok: false, msg: error.message };
        }
        const d: any = data || {};
        // 🪤 ردُّ jsonb لا استثناء: `ok:false` تصل بـ`error=null` من PostgREST،
        //    فمن يفحص `error` وحده يرى «نجاحاً» لنداءٍ مرفوض (الأزرار الصامتة).
        if (d.ok !== true) return { ok: false, msg: d.error || 'FAILED' };
        return {
            ok: true,
            rows: (Array.isArray(d.rows) ? d.rows : []).map(mapRow),
            stats: d.stats ? mapStats(d.stats) : null,
            nextCursor: d.next_cursor ?? null,
            nextCursorId: d.next_cursor_id ?? null,
        };
    },
};
