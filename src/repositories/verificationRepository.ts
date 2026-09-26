/**
 * verificationRepository — توثيق المتجر قبل النشر (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ما كان: «أي شخصٍ يصير متجراً حيّاً في دقيقتين» — بلا رقم سجلٍّ ولا اسمٍ
 *    مسجَّل ولا مراجعةٍ من بشر. وفاتورةُ الطلب (v14.17) تُطبع **برقم التاجر
 *    الضريبي وحده**، أي أن المنصّة كانت تُصدر مستنداً باسم هويّةٍ لم تُفحص قطّ.
 *
 * ما صار: طلبٌ واحدٌ مفتوح لكل متجر، يراجعه بشرٌ ويعتمده، ويُكتب الرقم المعتمد
 * في `store_profiles.cr_number` **بدور الأدمن وحده** — فلا نسختان متباعدتان
 * من هويّةٍ واحدة (درس v14.71: عمودان في جدولين وكاتبان لا يعرف أحدهما الآخر).
 *
 * 🪤 كل الكتابات عبر دوال SECURITY DEFINER: لا سياسة كتابة على
 *    `store_verifications` إطلاقاً، و`REVOKE INSERT,UPDATE,DELETE` صريح لأن
 *    سوبابيس تمنح `authenticated` كل DML على أي جدولٍ عامّ جديد افتراضياً.
 *
 * 🪤 ولا تُخترع هنا رسالةُ خطأ: الدوال تُرجع **رمزاً** (`NUMBER_TAKEN`…)
 *    والنصُّ في `SUBMIT_ERRORS` أدناه — مكانٌ واحد يقرؤه كل مَن يعرض الخطأ.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// الأنواع — مطابقةٌ لقيود CHECK على `public.store_verifications`
// ═══════════════════════════════════════════════════════════════════════════
export type VerificationStatus =
    | 'submitted'    // بانتظار المراجعة
    | 'approved'     // معتمد (وهو وحده يعني «موثّق»، ما لم ينتهِ التاريخ)
    | 'rejected'     // مرفوض بسببٍ مذكور
    | 'withdrawn'    // سحبه التاجر قبل البتّ
    | 'expired'      // انتهت صلاحية الوثيقة (كرون يومي)
    | 'revoked'      // سحبته الإدارة بعد الاعتماد
    | 'superseded';  // حلّ محلّه اعتمادٌ أحدث

export type DocKind = 'business_sa' | 'cr' | 'freelance';

/** درجةُ الإسناد: `registry` من سجلٍّ رسمي · `declared` إقرارٌ من صاحبه. */
export type Assurance = 'registry' | 'declared';

export type VerificationMode = 'off' | 'advisory' | 'required';

/** رموز الرفض — القائمة **مقفلة بقيد CHECK على القاعدة**، فلا يُضاف رمزٌ هنا
 *  وحده: الكتابة برمزٍ خارجها تُرفض بانتهاك قيد، لا برسالة مفهومة. */
export type RejectCode =
    | 'not_found' | 'name_mismatch' | 'expired_doc' | 'suspended_doc'
    | 'not_owner' | 'duplicate_cr' | 'wrong_activity' | 'other';

/** حالة التاجر كما تُرجعها `my_verification_state()`. */
export interface MyVerification {
    /** الوضع **الفعليّ** بعد أثر «السفر» (`vacation` يُنزِّل required ⇐ advisory). */
    mode: VerificationMode;
    /** المهلة المعلنة للمراجعة — لا يُكتب رقمها نصّاً في أي مكان (درس v14.12). */
    slaHours: number;
    /** موثّقٌ الآن فعلاً (معتمد وغير منتهٍ). */
    verified: boolean;
    /** امتيازٌ انتقاليّ يسمح بالنشر حتى هذا التاريخ، أو `null`. */
    graceUntil: string | null;
    /** `none` = لم يُرسل طلباً قطّ. */
    status: VerificationStatus | 'none';
    docKind: DocKind | null;
    docNumber: string | null;
    /** الاسم كما اعتمده الأدمن من السجل (بعد القبول). */
    legalName: string | null;
    /** الاسم كما كتبه التاجر عند الإرسال — لقطةٌ للمقارنة. */
    claimedName: string | null;
    docExpiry: string | null;
    rejectCode: RejectCode | null;
    adminNote: string | null;
    submittedAt: string | null;
    decidedAt: string | null;
    /** طلبٌ مفتوح الآن — لا يُقبل ثانٍ قبل البتّ فيه. */
    hasOpen: boolean;
}

/** صفٌّ في طابور المراجعة (`admin_list_verifications`). */
export interface AdminVerificationRow {
    id: string;
    storeId: string;
    shop: string | null;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
    docKind: DocKind;
    docNumber: string;
    claimedName: string | null;
    legalName: string | null;
    docExpiry: string | null;
    status: VerificationStatus;
    rejectCode: RejectCode | null;
    adminNote: string | null;
    submittedAt: string;
    decidedAt: string | null;
    /** الرقم نفسه على طلبٍ آخر مفتوحٍ أو معتمد — إنذارُ ازدواجٍ للمراجع. */
    dupNumber: boolean;
    /** الاسم المكتوب يطابق اسم المتجر (بعد التطبيع العربي على الخادم). */
    nameMatches: boolean;
}

/** عدّادات شاشة الأدمن (`admin_verification_stats`) — تُقرأ **قبل** تبديل الوضع. */
export interface VerificationStats {
    mode: VerificationMode;
    policy: { mode: VerificationMode; sla_hours: number; vacation: boolean; show_badge: boolean };
    pending: number;
    oldestPendingHours: number | null;
    approved: number;
    rejected30d: number;
    expiring30d: number;
    merchants: number;
    /** كم تاجراً سيُمنع من النشر لو صار الوضع `required` الآن. */
    wouldBlock: number;
    /** وكم عرضاً حيّاً يخصّهم — رقمُ نصف القطر الحقيقي. */
    wouldBlockLiveDeals: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// الكتالوج: نوعُ الوثيقة، ومن أين يجلب التاجر رقمها
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🪤 `hint` مرشِّحُ أخطاءٍ مطبعية **لا إثبات**: لا خانة تدقيق منشورة لأي سجلٍّ
 *    سعودي. والقاعدة هي الحَكَم (`merchant_submit_verification` تُعيد
 *    `BAD_NUMBER`) — فما هنا نسخةٌ للعرض تُوفّر على التاجر نداءً فاشلاً.
 */
export const DOC_KINDS: {
    kind: DocKind; ar: string; en: string; url: string;
    hintAr: string; hintEn: string; test: (n: string) => boolean;
}[] = [
    {
        kind: 'business_sa', ar: 'منصّة الأعمال', en: 'Business Center',
        url: 'https://business.sa',
        hintAr: 'رقم المنشأة كما يظهر في منصّة الأعمال (٥–١٤ رقماً).',
        hintEn: 'Establishment number as shown on the Business Center (5–14 digits).',
        test: (n) => /^[0-9]{5,14}$/.test(n.trim()),
    },
    {
        kind: 'cr', ar: 'السجل التجاري', en: 'Commercial Registration',
        url: 'https://cr.mc.gov.sa',
        hintAr: 'رقم السجل التجاري — عشرة أرقام.',
        hintEn: 'Commercial registration number — 10 digits.',
        test: (n) => /^[0-9]{10}$/.test(n.trim()),
    },
    {
        kind: 'freelance', ar: 'وثيقة العمل الحر', en: 'Freelance document',
        url: 'https://freelance.sa',
        hintAr: 'رقم وثيقة العمل الحر كما يظهر في المنصّة.',
        hintEn: 'Freelance document number as shown on the platform.',
        test: (n) => n.trim().length >= 4,
    },
];

export const docKindInfo = (kind: DocKind | null | undefined) =>
    DOC_KINDS.find(k => k.kind === kind) || null;

/**
 * أسبابُ الرفض الثمانية.
 * `ar`/`en` نصُّ الاختيار أمام المراجع، و`merchantAr` **النصّ الذي سيصل
 * التاجر فعلاً** — منسوخٌ حرفياً من الهجرة كي يرى المراجع ما يقوله لا ما
 * يظنّه (درس v14.82: وثيقةٌ تَعِد بما لا يُنفَّذ أسوأ من وثيقةٍ لا تَعِد).
 */
export const REJECT_REASONS: {
    code: RejectCode; ar: string; en: string; merchantAr: string;
}[] = [
    { code: 'not_found',      ar: 'رقم غير صحيح',                en: 'Number not found',      merchantAr: 'الرقم غير موجود في السجل الرسمي.' },
    { code: 'suspended_doc',  ar: 'السجل غير سارٍ',              en: 'Registration suspended', merchantAr: 'السجل موقوف.' },
    { code: 'name_mismatch',  ar: 'الاسم لا يطابق',              en: 'Name mismatch',         merchantAr: 'الاسم في السجل لا يطابق اسم متجرك.' },
    { code: 'wrong_activity', ar: 'النشاط لا يناسب المنصّة',     en: 'Activity not eligible', merchantAr: 'النشاط لا يشمل البيع الإلكتروني.' },
    { code: 'expired_doc',    ar: 'وثيقة منتهية',                en: 'Document expired',      merchantAr: 'السجل/الوثيقة منتهية الصلاحية.' },
    { code: 'duplicate_cr',   ar: 'الرقم مستعمل لمتجرٍ آخر',     en: 'Number already used',   merchantAr: 'هذا الرقم موثَّق لمتجرٍ آخر.' },
    { code: 'not_owner',      ar: 'الوثيقة ليست باسم صاحب الحساب', en: 'Not the account owner', merchantAr: 'الوثيقة ليست باسم صاحب الحساب.' },
    { code: 'other',          ar: 'أخرى',                        en: 'Other',                 merchantAr: 'راجع الملاحظة أدناه.' },
];

export const rejectReason = (code: RejectCode | null | undefined) =>
    REJECT_REASONS.find(r => r.code === code) || null;

/** رموزُ رفض الإرسال ونصُّها — مكانٌ واحد لا يُعاد كتابته في كل شاشة. */
const SUBMIT_ERRORS: Record<string, { ar: string; en: string }> = {
    AUTH_REQUIRED:   { ar: 'سجّل دخولك أولاً.', en: 'Please sign in first.' },
    NOT_A_MERCHANT:  { ar: 'هذا الحساب ليس حساب تاجر. تواصل مع إدارة تاكي لتحويله.', en: 'This is not a merchant account. Contact TAKI to switch it.' },
    BAD_KIND:        { ar: 'اختر نوع الوثيقة.', en: 'Pick a document type.' },
    BAD_NUMBER:      { ar: 'الرقم غير مطابق لصيغة هذه الوثيقة — راجعه رقماً رقماً.', en: 'The number does not match this document’s format — check it digit by digit.' },
    BAD_NAME:        { ar: 'اكتب الاسم المسجَّل كاملاً كما في الوثيقة.', en: 'Write the full registered name exactly as on the document.' },
    ALREADY_PENDING: { ar: 'لديك طلبٌ قيد المراجعة — اسحبه أولاً إن أردت تعديله.', en: 'You already have a request under review — withdraw it first to change it.' },
    NUMBER_TAKEN:    { ar: 'هذا الرقم موثَّق لمتجرٍ آخر. إن كان لك فتواصل مع إدارة تاكي.', en: 'This number is already verified for another store. Contact TAKI if it is yours.' },
    TOO_MANY:        { ar: 'حاولت مرّاتٍ كثيرة اليوم — أعِد المحاولة غداً.', en: 'Too many attempts today — try again tomorrow.' },
    NO_OPEN_REQUEST: { ar: 'لا يوجد طلبٌ مفتوح لسحبه.', en: 'There is no open request to withdraw.' },
};

/** نصُّ رمزٍ راجعٍ من دوال التاجر — و`null` لرمزٍ لا نعرفه (يُبقي المنادي بديله). */
export const submitErrorText = (code: string | undefined | null, isRTL: boolean): string | null => {
    if (!code) return null;
    const e = SUBMIT_ERRORS[code];
    return e ? (isRTL ? e.ar : e.en) : null;
};

// ═══════════════════════════════════════════════════════════════════════════
// المحوّلات — صفُّ jsonb ⇐ الشكل الذي تقرؤه الواجهة
// ═══════════════════════════════════════════════════════════════════════════
const numOrNull = (x: any): number | null => {
    const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''));
    return Number.isFinite(n) ? n : null;
};

const mapMyState = (d: any): MyVerification => ({
    mode: (['off', 'advisory', 'required'].includes(d?.mode) ? d.mode : 'off') as VerificationMode,
    // 🪤 `Number(null)` صفرٌ صالح — ومهلةٌ صفرٌ مهلةٌ منتهية قبل أن تبدأ (v14.92).
    slaHours: numOrNull(d?.sla_hours) ?? 24,
    verified: d?.verified === true,
    graceUntil: d?.grace_until ?? null,
    status: (d?.status || 'none') as VerificationStatus | 'none',
    docKind: (d?.doc_kind ?? null) as DocKind | null,
    docNumber: d?.doc_number ?? null,
    legalName: d?.legal_name ?? null,
    claimedName: d?.claimed_name ?? null,
    docExpiry: d?.doc_expiry ?? null,
    rejectCode: (d?.reject_code ?? null) as RejectCode | null,
    adminNote: d?.admin_note ?? null,
    submittedAt: d?.submitted_at ?? null,
    decidedAt: d?.decided_at ?? null,
    hasOpen: d?.has_open === true,
});

const mapAdminRow = (r: any): AdminVerificationRow => ({
    id: r.id,
    storeId: r.store_id,
    shop: r.shop ?? null,
    ownerName: r.owner_name ?? null,
    ownerPhone: r.owner_phone ?? null,
    ownerEmail: r.owner_email ?? null,
    docKind: r.doc_kind,
    docNumber: r.doc_number,
    claimedName: r.claimed_name ?? null,
    legalName: r.legal_name ?? null,
    docExpiry: r.doc_expiry ?? null,
    status: r.status,
    rejectCode: (r.reject_code ?? null) as RejectCode | null,
    adminNote: r.admin_note ?? null,
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at ?? null,
    dupNumber: r.dup_number === true,
    nameMatches: r.name_matches === true,
});

export const verificationRepository = {
    /**
     * حالة متجري. تُفرّق ثلاثَ حالاتٍ لا اثنتين (درس `storePolicies` في v14.18):
     *  • `ok:false`            — **لم يُجب الخادم**، فلا يُقال للتاجر شيءٌ قاطع.
     *  • `ok:true, state:null` — أجاب، وهذا الحساب ليس حساب تاجر أصلاً.
     *  • `ok:true, state:{…}`  — الحالة.
     */
    myState: async (): Promise<{ ok: boolean; state?: MyVerification | null; msg?: string }> => {
        const { data, error } = await supabase.rpc('my_verification_state');
        if (error) { logger.warn('my_verification_state:', error.message); return { ok: false, msg: error.message }; }
        if (data == null) return { ok: true, state: null };
        return { ok: true, state: mapMyState(data) };
    },

    /**
     * إرسال طلب التوثيق. `expiry` تاريخٌ بصيغة `YYYY-MM-DD` أو `null`
     * (السجل الجديد ألغى الانتهاء، فالفراغ حالةٌ صحيحة لا نقصٌ في البيانات).
     */
    submit: async (
        kind: DocKind, number: string, legalName: string, expiry?: string | null,
    ): Promise<{ ok: boolean; id?: string; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('merchant_submit_verification', {
            p_kind: kind,
            p_number: number.trim(),
            p_legal_name: legalName.trim(),
            p_expiry: expiry || null,
        });
        if (error) { logger.warn('merchant_submit_verification:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        // 🪤 الردُّ jsonb لا استثناء: `ok:false` تصل بـ`error=null` من PostgREST،
        //    فمن يفحص `error` وحده يرى «نجاحاً» لطلبٍ لم يُحفظ (الأزرار الصامتة).
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, id: d.id };
    },

    /** سحبُ الطلب المفتوح قبل البتّ فيه. */
    withdraw: async (): Promise<{ ok: boolean; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('merchant_withdraw_verification');
        if (error) { logger.warn('merchant_withdraw_verification:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        return d.ok ? { ok: true } : { ok: false, error: d.error || 'FAILED' };
    },

    /**
     * شارةُ المشتري. مُتاحةٌ للزائر بلا حساب عمداً — وهي **الشيء الوحيد** الذي
     * يراه من هذا النظام كلّه.
     * 🪤 بوّابةُ `show_badge` **على الخادم داخل الدالّة**: لا يُضاف فحصٌ ثانٍ في
     *    الواجهة، وإلا صار للمفتاح مصدران يفترقان (درس v14.71).
     */
    isVerified: async (storeId: string): Promise<boolean> => {
        if (!storeId) return false;
        try {
            const { data, error } = await supabase.rpc('store_is_verified', { p_store_id: storeId });
            if (error) { logger.warn('store_is_verified:', error.message); return false; }
            return data === true;
        } catch { return false; }
    },

    // ── الأدمن ───────────────────────────────────────────────────────────────
    /**
     * طابورُ المراجعة. `cursor` هو `submittedAt` آخر صفٍّ في الصفحة السابقة
     * (keyset على `submitted_at < cursor`) — لا OFFSET، فلا يسقط صفٌّ بين
     * صفحتين حين يصل طلبٌ جديد أثناء التصفّح (قاعدة «لا يسقط شيء»).
     * `status = null` يعني **كل** الحالات.
     */
    adminList: async (
        status: VerificationStatus | null = 'submitted',
        limit = 50,
        cursor: string | null = null,
    ): Promise<{ ok: boolean; rows?: AdminVerificationRow[]; nextCursor?: string | null; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_list_verifications', {
            p_status: status, p_limit: limit, p_cursor: cursor,
        });
        if (error) { logger.warn('admin_list_verifications:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        if (!d.ok) return { ok: false, msg: d.error };
        const rows: AdminVerificationRow[] = (Array.isArray(d.rows) ? d.rows : []).map(mapAdminRow);
        // صفحةٌ ناقصة = لا مزيد. ومؤشّرٌ بلا صفوفٍ بعده يُعيد صفحةً فارغة لا خطأ.
        const nextCursor = rows.length === limit && rows.length > 0
            ? rows[rows.length - 1].submittedAt
            : null;
        return { ok: true, rows, nextCursor };
    },

    /**
     * قرارُ المراجع. `nameAck` إقرارٌ صريح بأن اسم السجل يخالف اسم المتجر:
     * بلا هذا الإقرار تردّ القاعدة `NAME_MISMATCH_UNACKED` ومعها الاسمان — فلا
     * يُعتمد اختلافُ اسمٍ بالسهو (والفاتورة تحمل الاسم المسجَّل).
     */
    adminResolve: async (p: {
        id: string;
        approve: boolean;
        legalName?: string | null;
        note?: string | null;
        rejectCode?: RejectCode | null;
        expiry?: string | null;
        nameAck?: boolean;
    }): Promise<{
        ok: boolean; approved?: boolean; error?: string;
        legalName?: string; shop?: string; status?: string; msg?: string;
    }> => {
        const { data, error } = await supabase.rpc('admin_resolve_verification', {
            p_id: p.id,
            p_approve: p.approve,
            p_legal_name: p.legalName?.trim() || null,
            p_note: p.note?.trim() || null,
            p_reject_code: p.rejectCode || null,
            p_expiry: p.expiry || null,
            p_name_ack: p.nameAck === true,
        });
        if (error) { logger.warn('admin_resolve_verification:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        if (!d.ok) {
            return {
                ok: false, error: d.error || 'FAILED',
                legalName: d.legal_name, shop: d.shop, status: d.status,
            };
        }
        return { ok: true, approved: d.approved === true };
    },

    /**
     * سحبُ توثيقٍ معتمد. يُوقف عروض المتجر الحيّة فوراً ويُخبره — والرقمُ
     * المُعاد (`pausedDeals`) هو الدليل، لا الافتراض.
     */
    adminRevoke: async (
        storeId: string, reason: string,
    ): Promise<{ ok: boolean; pausedDeals?: number; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_revoke_verification', {
            p_store_id: storeId, p_reason: reason?.trim() || null,
        });
        if (error) { logger.warn('admin_revoke_verification:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, pausedDeals: Number(d.paused_deals) || 0 };
    },

    /**
     * الامتيازُ الانتقاليّ: لقطةٌ مجمّدة لكل تاجرٍ قائمٍ **تلك اللحظة** يسمح له
     * بالنشر حتى `until`. لا يُشتقّ من عمودٍ يملكه التاجر (وإلا صار خانةَ نشرٍ
     * دائمة)، و`until` نصٌّ ISO.
     */
    adminOpenGrace: async (
        until: string,
    ): Promise<{ ok: boolean; stores?: number; until?: string; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_open_verification_grace', { p_until: until });
        if (error) { logger.warn('admin_open_verification_grace:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, stores: Number(d.stores) || 0, until: d.until };
    },

    /** عدّادات نصف القطر — تُقرأ **قبل** كل تبديل وضع، لا بعده. */
    adminStats: async (): Promise<{ ok: boolean; stats?: VerificationStats; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_verification_stats');
        if (error) { logger.warn('admin_verification_stats:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        return {
            ok: true,
            stats: {
                mode: (['off', 'advisory', 'required'].includes(d.mode) ? d.mode : 'off') as VerificationMode,
                policy: d.policy || { mode: 'off', sla_hours: 24, vacation: false, show_badge: false },
                pending: Number(d.pending) || 0,
                // 🪤 `null` هنا تعني «لا طلب معلَّق» لا «صفر ساعة» — وصفرُ ساعةٍ
                //    على شاشةٍ يقرؤها ناصر يعني «كل شيء منجَز»، وهو غيرُ ما جرى.
                oldestPendingHours: numOrNull(d.oldest_pending_hours),
                approved: Number(d.approved) || 0,
                rejected30d: Number(d.rejected_30d) || 0,
                expiring30d: Number(d.expiring_30d) || 0,
                merchants: Number(d.merchants) || 0,
                wouldBlock: Number(d.would_block) || 0,
                wouldBlockLiveDeals: Number(d.would_block_live_deals) || 0,
            },
        };
    },

    /**
     * كنسةُ عروض غير الموثّقين. `dryRun = true` **يقيس ولا يلمس** — وهو
     * الافتراضي عمداً: الامتياز لا ينتهي من تلقاء نفسه، فالإيقاف قرارُ ناصر
     * بعد أن يرى الرقم، لا أثرٌ جانبيّ لتبديل وضع.
     */
    adminSweep: async (
        dryRun = true,
    ): Promise<{ ok: boolean; dryRun?: boolean; wouldPause?: number; paused?: number; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_sweep_unverified_deals', { p_dry_run: dryRun });
        if (error) { logger.warn('admin_sweep_unverified_deals:', error.message); return { ok: false, msg: error.message }; }
        const d: any = data || {};
        if (!d.ok) return { ok: false, msg: d.error };
        return {
            ok: true,
            dryRun: d.dry_run === true,
            wouldPause: d.would_pause != null ? Number(d.would_pause) || 0 : undefined,
            paused: d.paused != null ? Number(d.paused) || 0 : undefined,
        };
    },
};
