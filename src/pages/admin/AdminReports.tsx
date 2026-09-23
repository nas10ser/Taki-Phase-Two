/**
 * AdminReports — البلاغات والشكاوى (v14.89 — أُعيد تنظيمها على نظام لوحة الإدارة)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما تفعله الشاشة (بلا أي تغيير في السلوك): أربعة عروضٍ في تبويبٍ واحد —
 *   🚩 بلاغات المستخدمين · 📣 شكاوى للإدارة · ⚠️ إنذارات المسؤولين ·
 *   ⛔ حسابات أوقفتها الإدارة
 * ونفس نداءات القاعدة تماماً: `listReports` · `listComplaints` ·
 * `listWarnedUsers` · `admin_suspended_accounts` · `admin_reports_summary` ·
 * `setReportStatus` / `setComplaintStatus` · `suspendAccount` ·
 * `admin_set_booking_ban` · `admin_delete_warning`.
 *
 * 🔴 ما صُحِّح هنا — التباسٌ في التسمية كان يكلّف قراراً:
 *    كان العرض الفرعي هنا اسمه «⚠️ الإنذارات» ومصدره `user_warnings`
 *    (إنذاراتٌ على الحساب)، وفي الوقت نفسه تبويبٌ آخر في اللوحة اسمه
 *    «🛡 الإنذارات» ومصدره `moderation_flags` (مخالفاتٌ يرصدها النظام في
 *    المحتوى). اسمٌ واحد لرقمين مختلفين. الآن: **«إنذارات المسؤولين»** هنا،
 *    و«رصد المحتوى الآلي» هناك — والمعرّفات ونداءات القاعدة كما هي حرفياً.
 *
 * 🔴 ورقمٌ كان يكذب بنطاقه: بطاقات الأرقام تأتي من `admin_reports_summary`
 *    وهي **للمنصّة كلّها ولا تتأثّر بالمرشِّحات**، بينما القائمة تحتها مُرشَّحة.
 *    فكان زرّ «عرض المزيد» يقول «ظهر ٥٠ من ٤١٢» وهو يقارن مُرشَّحاً بغير
 *    مُرشَّح. الآن لكل بطاقةٍ `scope` يقول نطاقها، والزرّ يعدّ ما ظهر وحده.
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّجات: الألوان رموز `--adm-*` تتبع
 *    `.dark-mode`/`.light-mode`، واللون للدلالة وحدها (سليم/تحذير/خطر).
 *
 * متطلّبات المالك التي لم تُمَسّ:
 *  - هويّة المُبلِّغ والمُبلَّغ ضدّه ظاهرتان، والعدّادات لكل حساب.
 *  - الشكاوى تظهر هنا لا في البريد وحده.
 *  - المعالجة يدوية بالكامل — لا تقييد تلقائي.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
    adminService,
    AdminReportRow,
    AdminComplaintRow,
    WarnedUser,
    UserWarning,
} from '../../services/adminService';
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';
import { supabase } from '../../services/supabaseClient';
import {
    AdmSection, AdmPageHeader,
    AdmStat, AdmStatGrid,
    AdmPill, AdmEmpty, AdmSkeleton, AdmButton,
    admNum, toneFg, toneBg,
} from '../../components/admin/ui';
import type { Tone } from '../../components/admin/ui';

// ═══════════════════════════════════════════════════════════════════════════
// ثوابت العرض
// ═══════════════════════════════════════════════════════════════════════════

const REPORT_TYPES = [
    { value: 'scam', label: 'احتيال', icon: '⚠️' },
    { value: 'no_show', label: 'عدم حضور', icon: '🚷' },
    { value: 'harassment', label: 'تحرّش', icon: '🛑' },
    { value: 'inappropriate', label: 'محتوى غير لائق', icon: '🚫' },
    { value: 'spam', label: 'سبام', icon: '📛' },
    { value: 'other', label: 'أخرى', icon: '❓' },
];

/** الحالة → نغمة دلالة + تسمية. لا لون خارج النغمات الخمس. */
const STATUS_META: Record<string, { tone: Tone; label: string; icon: string }> = {
    open:         { tone: 'warn',    label: 'مفتوح',        icon: '🟠' },
    under_review: { tone: 'bad',     label: 'تحت المراجعة', icon: '🔴' },
    reviewing:    { tone: 'bad',     label: 'قيد المراجعة', icon: '🔴' },
    resolved:     { tone: 'ok',      label: 'تم الحل',      icon: '✅' },
    dismissed:    { tone: 'neutral', label: 'مرفوض',        icon: '⛔' },
};

type ViewId = 'reports' | 'complaints' | 'warnings' | 'suspended';

/**
 * أسماء العروض ووصفُ كلٍّ منها.
 * 🪤 الوصف ليس زينة: عرضان من الأربعة يتقاطعان مع شاشاتٍ أخرى في اللوحة
 *    (الإيقاف يظهر أيضاً في المشترين والتجّار، والإنذار يُشبه اسمَ تبويب
 *    الرصد الآلي) — فالوصف هو ما يمنع القارئ من الخلط.
 */
const VIEWS: Array<{ id: ViewId; icon: string; label: string; desc: string }> = [
    {
        id: 'reports', icon: '🚩', label: 'بلاغات المستخدمين',
        desc: 'بلاغاتٌ قدّمها مستخدمٌ ضدّ مستخدمٍ آخر. كل تغيير حالةٍ هنا يدويّ — لا تقييد تلقائي.',
    },
    {
        id: 'complaints', icon: '📣', label: 'شكاوى للإدارة',
        desc: 'رسائل أرسلها مستخدمون إلى فريق تاكي مباشرةً — لا ضدّ شخصٍ بعينه.',
    },
    {
        id: 'warnings', icon: '⚠️', label: 'إنذارات المسؤولين',
        desc: 'إنذاراتٌ أصدرها فريق الإدارة يدوياً على حساب. أمّا ما يرصده النظام تلقائياً داخل المحتوى (محادثات · تقييمات · عروض · صور) فمكانه تبويب «رصد المحتوى الآلي».',
    },
    {
        id: 'suspended', icon: '⛔', label: 'حسابات أوقفتها الإدارة',
        desc: 'هذه الشاشة هي مكان الإيقاف والرفع مع تسجيل السبب الذي يصل صاحب الحساب ويبقى في سجلّه. أمّا قائمتا «المشترون» و«التجّار» فتعرضان الحالة نفسها للتصفية فقط.',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// أدوات صغيرة
// ═══════════════════════════════════════════════════════════════════════════

const fmt = (iso: string) => {
    try {
        const d = new Date(iso);
        return d.toLocaleString('ar-SA-u-ca-gregory', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
};

const timeAgo = (iso: string): string => {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `قبل ${sec} ث`;
    if (sec < 3600) return `قبل ${Math.floor(sec / 60)} د`;
    if (sec < 86400) return `قبل ${Math.floor(sec / 3600)} س`;
    return `قبل ${Math.floor(sec / 86400)} ي`;
};

/** صفٌّ داخل قسم: سطحٌ أفتح من سطح القسم فلا يذوب فيه. */
const rowCard = (tone: Tone): React.CSSProperties => ({
    background: 'var(--adm-surface-2)',
    border: '1px solid var(--adm-border)',
    borderInlineStartWidth: 3,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: tone === 'neutral' ? 'var(--adm-border-strong)' : toneFg(tone),
    borderRadius: 'var(--adm-r-sm)',
    padding: '13px 14px',
});

const panelStyle: React.CSSProperties = {
    background: 'var(--adm-surface-3)',
    border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)',
    padding: '10px 12px',
};

const bodyText: React.CSSProperties = {
    margin: 0, fontSize: '.85rem', fontWeight: 500, lineHeight: 1.85,
    color: 'var(--adm-fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};

const metaText: React.CSSProperties = {
    fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)',
};

// ═══════════════════════════════════════════════════════════════════════════
// عناصر مشتركة
// ═══════════════════════════════════════════════════════════════════════════

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const s = STATUS_META[status] ?? { tone: 'neutral' as Tone, label: status, icon: '•' };
    return <AdmPill tone={s.tone}>{s.icon} {s.label}</AdmPill>;
};

/** زرُّ إجراءٍ بنغمة دلالة — النغمة تقول أثر الضغطة قبل الضغط. */
const ToneButton: React.FC<{
    tone: Tone;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}> = ({ tone, onClick, children, title }) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        className="adm-focusable"
        style={{
            padding: '5px 11px', borderRadius: 'var(--adm-r-sm)',
            fontSize: '.76rem', fontWeight: 800, whiteSpace: 'nowrap',
            border: '1px solid transparent', cursor: 'pointer',
            background: toneBg(tone), color: toneFg(tone),
        }}
    >
        {children}
    </button>
);

const FilterChip: React.FC<{
    active: boolean;
    onClick: () => void;
    label: string;
    icon?: string;
}> = ({ active, onClick, label, icon }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="adm-focusable"
        style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 11px', borderRadius: 999,
            fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
            border: `1px solid ${active ? 'transparent' : 'var(--adm-border)'}`,
            background: active ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
            color: active ? '#ffffff' : 'var(--adm-fg-2)',
        }}
    >
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
    </button>
);

const FilterRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ ...metaText, minWidth: 54 }}>{label}</span>
        {children}
    </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// الشاشة
// ═══════════════════════════════════════════════════════════════════════════

const AdminReports: React.FC = () => {
    const { customConfirm, customAlert, customPrompt } = useApp();
    const history = useHistory();

    const [view, setView] = useState<ViewId>('reports');
    const [reports, setReports] = useState<AdminReportRow[]>([]);
    const [complaints, setComplaints] = useState<AdminComplaintRow[]>([]);
    const [warned, setWarned] = useState<WarnedUser[]>([]);
    // v12.54 — «حسابات أوقفتها الإدارة» بأسبابها الكاملة (إنذارات/مخالفات/بلاغات)
    const [suspended, setSuspended] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [q, setQ] = useState('');
    const [status, setStatus] = useState<string>('');
    const [rtype, setRtype] = useState<string>('');
    const [days, setDays] = useState<number>(0);
    const [role, setRole] = useState<string>('');
    const [warnMin, setWarnMin] = useState<number>(1);
    // v14.33 — كان النداء بلا حدّ، فتُرجع القاعدة ١٠٠ صفّاً افتراضياً وتتوقّف،
    // بلا زرّ ولا رسالة. أي أن البلاغ رقم ١٠١ **غير موجود** في نظر الإدارة.
    const PAGE = 50;
    const [shown, setShown] = useState(PAGE);
    const [hasMore, setHasMore] = useState(false);
    // كل تغيير في المرشِّحات يُعيد العدّ من أوّله — وإلا بقي «عرض المزيد» يقيس قائمةً أخرى.
    useEffect(() => { setShown(PAGE); }, [view, q, status, rtype, days, role, warnMin]);

    const load = useCallback(async () => {
        setLoading(true);
        if (view === 'reports') {
            // صفٌّ زائد: به نعرف «هل بعدها المزيد» بلا نداء عدٍّ ثانٍ.
            const rows = await adminService.listReports({
                query: q, status: status || null, type: rtype || null,
                reportedRole: (role || null) as any, days,
                limit: shown + 1, offset: 0,
            });
            setHasMore(rows.length > shown);
            setReports(rows.slice(0, shown));
        } else if (view === 'complaints') {
            const rows = await adminService.listComplaints({
                query: q, status: status || null, limit: shown + 1, offset: 0,
            });
            setHasMore(rows.length > shown);
            setComplaints(rows.slice(0, shown));
        } else if (view === 'suspended') {
            const { data } = await supabase.rpc('admin_suspended_accounts');
            setSuspended(Array.isArray(data) ? data : []);
        } else {
            const rows = await adminService.listWarnedUsers({ role: role || null, minCount: warnMin, search: q });
            setWarned(rows);
        }
        setLoading(false);
    }, [view, q, status, rtype, days, role, warnMin, shown]);

    useEffect(() => { load(); }, [load]);

    const changeReportStatus = async (id: string, next: string) => {
        const labelNext = STATUS_META[next]?.label ?? next;
        const ok = await customConfirm(`تغيير حالة البلاغ إلى «${labelNext}»؟`);
        if (!ok) return;
        const r = await adminService.setReportStatus(id, next);
        if (r.success) load();
        else customAlert('❌ تعذّر تحديث الحالة');
    };
    const changeComplaintStatus = async (id: string, next: string) => {
        const labelNext = STATUS_META[next]?.label ?? next;
        const ok = await customConfirm(`تغيير حالة الشكوى إلى «${labelNext}»؟`);
        if (!ok) return;
        const r = await adminService.setComplaintStatus(id, next);
        if (r.success) load();
        else customAlert('❌ تعذّر تحديث الحالة');
    };

    const toggleSuspend = async (userId: string, suspend: boolean, name: string) => {
        if (suspend) {
            // السبب ليس تحسيناً: هو ما يظهر لصاحب الحساب في إشعاره وفي سجلّ
            // إنذاراته، وما تعود إليه أنت بعد شهر حين يسألك «لماذا أُوقفت؟».
            const reason = await customPrompt(
                `⛔ إيقاف حساب «${name}»\n\nسيُمنع من تسجيل الدخول فوراً، وتُنهى جلساته المفتوحة، وإن كان تاجراً تختفي عروضه من المنصّة ولا يستطيع نشر غيرها.\n\nاكتب السبب (يصل صاحب الحساب ويُحفظ في سجلّه):`);
            if (reason == null) return;
            const txt = String(reason).trim();
            if (txt.length < 3) { await customAlert('⚠️ اكتب سبباً واضحاً — يصل صاحب الحساب.'); return; }
            const r = await adminService.suspendAccount(userId, true, txt);
            if (!r.success) { customAlert('❌ تعذّر تنفيذ الإجراء'); return; }
            await customAlert(`⛔ أُوقف الحساب.\n• مُنع من تسجيل الدخول\n• أُنهيت ${r.sessionsKilled || 0} جلسة مفتوحة\n• وصله إشعار بالسبب`);
            load();
            return;
        }
        const ok = await customConfirm(`رفع الإيقاف عن حساب «${name}»؟ سيعود الدخول والعروض كما كانت.`);
        if (!ok) return;
        const r = await adminService.suspendAccount(userId, false);
        if (r.success) { await customAlert('✅ رُفع الإيقاف وعاد الحساب للعمل'); load(); }
        else customAlert('❌ تعذّر تنفيذ الإجراء');
    };

    // v12.79 — عقوبة «تعليق الحجز»: عقوبةٌ أخفّ من إيقاف الحساب — الحساب يبقى
    // نشطاً ويدخل ويتصفّح، لكنه لا يستطيع الحجز للمدّة المحدّدة (الحارس
    // tr_booking_ban في القاعدة يغطّي الويب والبوتين).
    // 🪤 اسمها يبقى «تعليق الحجز» لا «إيقاف»: إشعار القاعدة الذي يصل المستخدم
    //    يقول «تم تعليق الحجز» حرفياً، وAppContext يطابق ذلك النصّ — فتوحيد
    //    الكلمة هنا وحدها كان سيخلق اختلافاً بين ما يقرؤه المسؤول وما يصل العميل.
    const bookingBan = async (userId: string, name: string) => {
        const raw = await customPrompt(`⏸️ تعليق الحجز على «${name}» — اكتب عدد الأيام (مثال: 7):`);
        if (raw == null) return;
        const days = Math.round(Number(String(raw).replace(/[^\d]/g, '')));
        if (!days || days <= 0) { await customAlert('⚠️ اكتب عدد أيام صحيحاً أكبر من صفر.'); return; }
        const { data, error } = await supabase.rpc('admin_set_booking_ban', { p_user_id: userId, p_days: days, p_reason: 'قرار إداري' });
        if (error || !(data as any)?.success) { await customAlert('❌ تعذّر التعليق: ' + (error?.message || '')); return; }
        await customAlert(`⏸️ تم تعليق الحجز على «${name}» لمدة ${days} يوماً — وصله إشعار بذلك.`);
    };
    const bookingBanLift = async (userId: string, name: string) => {
        const ok = await customConfirm(`▶️ رفع تعليق الحجز عن «${name}»؟`);
        if (!ok) return;
        const { error } = await supabase.rpc('admin_set_booking_ban', { p_user_id: userId, p_days: 0 });
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert('✅ تم رفع تعليق الحجز.');
    };

    const openAccount = (id: string, partyRole: string, name?: string) => {
        if (partyRole === 'seller') history.push(`/store/${id}`);
        else history.push(`/admin?tab=buyers&q=${encodeURIComponent(name || id)}`);
    };

    // v14.33 — البطاقات كانت تعدّ **الصفوف المحمّلة** وتكتب تحتها «الإجمالي»،
    // ومع سقف ١٠٠ صفّاً كان «الإجمالي» يتجمّد عند ١٠٠ إلى الأبد وقرارات الرقابة
    // تُتّخذ على عيّنة يظنّها ناصر كلّ شيء. الآن العدّ من الجدول كلّه.
    const [serverSummary, setServerSummary] = useState<any>(null);
    useEffect(() => {
        let alive = true;
        supabase.rpc('admin_reports_summary').then(({ data }) => { if (alive) setServerSummary(data); });
        return () => { alive = false; };
    }, [view, reports.length, complaints.length]);

    const summary = useMemo(() => {
        const side = view === 'reports' ? serverSummary?.reports : serverSummary?.complaints;
        if (side) {
            return { open: Number(side.open) || 0, review: Number(side.review) || 0,
                     resolved: Number(side.resolved) || 0, total: Number(side.total) || 0 };
        }
        // احتياطٌ لثوانٍ قبل وصول جواب الخادم — لا بديلٌ دائم.
        const rows: any[] = view === 'reports' ? reports : complaints;
        const openKey = view === 'reports' ? 'open' : 'open';
        const revKey  = view === 'reports' ? 'under_review' : 'reviewing';
        return {
            open: rows.filter(r => r.status === openKey).length,
            review: rows.filter(r => r.status === revKey).length,
            resolved: rows.filter(r => r.status === 'resolved').length,
            total: rows.length,
        };
    }, [view, reports, complaints, serverSummary]);

    /**
     * 🪤 نطاق بطاقات الأرقام ليس تفصيلاً: `admin_reports_summary` لا تأخذ أي
     *    مرشِّح — فرقمها عن **كل المنصّة** بينما القائمة تحته مُرشَّحة. وحتى
     *    تصل إجابة الخادم (ثوانٍ) يكون الرقم عن الصفوف المحمّلة وحدها.
     */
    const summaryScope = serverSummary
        ? 'كل المنصّة — لا يتأثّر بالمرشِّحات'
        : 'الصفوف المحمّلة الآن — بانتظار الخادم';

    const warnSummary = useMemo(() => {
        const danger = warned.filter((w) => w.warn_count >= 3).length;
        const totalStrikes = warned.reduce((s, w) => s + w.warn_count, 0);
        return { users: warned.length, danger, totalStrikes };
    }, [warned]);

    /**
     * 🪤 لا يُعدّ بـ`user_type === 'seller'`: متجر ناصر يملكه حساب أدمن، وكل
     *    مرشِّح «seller» يُخفيه (درس مسجَّل في قواعد المشروع). العدّ بغير
     *    المشتري — وهو ما يقوله عنوان البطاقة ووصفها.
     */
    const suspendedStores = useMemo(
        () => suspended.filter((u: any) => u.user_type !== 'buyer').length,
        [suspended],
    );

    const clearFilters = () => { setQ(''); setStatus(''); setRtype(''); setDays(0); setRole(''); setWarnMin(1); };
    const hasFilters = !!(q || status || rtype || days || role || (view === 'warnings' && warnMin > 1));
    const warnFiltered = !!(q || role || warnMin > 1);
    /**
     * 🪤 لا يُكتب هنا «كل المنصّة»: `admin_list_warned_users` بلا حدٍّ في نصّها،
     *    لكن الخادم يردّ ١٠٠ صفّاً افتراضياً ويتوقّف (الدرس المدفوع في v14.33
     *    على `listReports` نفسها) — ولا ترقيم صفحاتٍ في هذا العرض. فالعدّ عن
     *    الصفوف المعروضة، والتسمية تقول ذلك بدل أن تدّعي الشمول.
     */
    const warnScope = warnFiltered ? 'من الحسابات المعروضة بالمرشِّحات' : 'من الحسابات المعروضة';
    const warnScopeHint = 'العدّ من الصفوف المعروضة أمامك. الخادم يردّ حتى ١٠٠ صفّاً في النداء الواحد — فإن زاد العدد ضيّق البحث أو نوع الحساب.';

    const cur = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
    const showListFilters = view !== 'suspended';

    // ── الأرقام ──────────────────────────────────────────────────────────
    const stats = view === 'suspended' ? (
        <AdmStatGrid cols={2}>
            <AdmStat
                label="حسابات موقوفة الآن"
                value={admNum(suspended.length)}
                tone={suspended.length > 0 ? 'bad' : 'ok'}
                icon="⛔"
                scope="كل المنصّة"
                title="كل حساب أوقفته الإدارة يدوياً أو أوقفه النظام تلقائياً بعد 3 مخالفات"
            />
            <AdmStat
                label="منها متاجر"
                value={admNum(suspendedStores)}
                tone={suspendedStores > 0 ? 'warn' : 'neutral'}
                icon="🏪"
                scope="كل المنصّة"
                title="كل حسابٍ موقوفٍ غير مشترٍ — التاجر، وحسابُ الإدارة الذي يملك متجراً. ومتجرٌ موقوف تختفي عروضه من المنصّة حتى يُرفع الإيقاف."
            />
        </AdmStatGrid>
    ) : view === 'warnings' ? (
        <AdmStatGrid cols={3}>
            <AdmStat label="حسابات عليها إنذارات" value={admNum(warnSummary.users)} tone="warn" icon="⚠️" scope={warnScope} title={warnScopeHint} />
            <AdmStat label="إجمالي الإنذارات الصادرة" value={admNum(warnSummary.totalStrikes)} icon="Σ" scope={warnScope} title={warnScopeHint} />
            <AdmStat
                label="حسابات بـ3 إنذارات فأكثر"
                value={admNum(warnSummary.danger)}
                tone={warnSummary.danger > 0 ? 'bad' : 'ok'}
                icon="🔴"
                scope={warnScope}
                title={`العتبة التي يُنصح عندها باتخاذ إجراء. ${warnScopeHint}`}
            />
        </AdmStatGrid>
    ) : (
        <AdmStatGrid cols={4}>
            <AdmStat label="مفتوح — يحتاج مراجعة" value={admNum(summary.open)} tone="warn" icon="🟠" scope={summaryScope} />
            <AdmStat
                label={view === 'reports' ? 'تحت المراجعة' : 'قيد المراجعة'}
                value={admNum(summary.review)} tone="bad" icon="🔴" scope={summaryScope}
            />
            <AdmStat label="تم الحل" value={admNum(summary.resolved)} tone="ok" icon="✅" scope={summaryScope} />
            <AdmStat label="الإجمالي" value={admNum(summary.total)} icon="Σ" scope={summaryScope} />
        </AdmStatGrid>
    );

    // ── محتوى القائمة ────────────────────────────────────────────────────
    const clearAction = hasFilters
        ? <AdmButton size="sm" onClick={clearFilters}>✕ امسح المرشِّحات</AdmButton>
        : undefined;

    let body: React.ReactNode;
    if (loading) {
        body = <AdmSkeleton rows={4} height={104} />;
    } else if (view === 'reports') {
        body = reports.length === 0 ? (
            <AdmEmpty
                icon="🎉"
                title={hasFilters ? 'لا بلاغ يطابق هذه المرشِّحات' : 'لا توجد بلاغات حالياً'}
                hint={hasFilters
                    ? 'المرشِّحات الحالية ضيّقة — وسّع الفترة أو امسحها لترى القائمة كاملة.'
                    : 'أي بلاغٍ يقدّمه مستخدمٌ ضدّ آخر يظهر هنا فور وصوله، ويبقى حتى تغيّر حالته بنفسك.'}
                action={clearAction}
            />
        ) : (
            <div style={{ display: 'grid', gap: 10 }}>
                {reports.map((r) => (
                    <ReportCard key={r.id} report={r} onOpenAccount={openAccount} onStatusChange={changeReportStatus} />
                ))}
                {hasMore && (
                    <AdmButton full onClick={() => setShown((n) => n + PAGE)} disabled={loading}>
                        {loading ? 'جارٍ التحميل…' : `عرض المزيد — ظهر ${admNum(reports.length)} صفّاً`}
                    </AdmButton>
                )}
            </div>
        );
    } else if (view === 'complaints') {
        body = complaints.length === 0 ? (
            <AdmEmpty
                icon="🎉"
                title={hasFilters ? 'لا شكوى تطابق هذه المرشِّحات' : 'لا توجد شكاوى حالياً'}
                hint={hasFilters
                    ? 'جرّب حالةً أخرى أو امسح المرشِّحات.'
                    : 'أي شكوى يرسلها مستخدم إلى فريق تاكي تظهر هنا — لا في البريد وحده.'}
                action={clearAction}
            />
        ) : (
            <div style={{ display: 'grid', gap: 10 }}>
                {complaints.map((c) => (
                    <ComplaintCard key={c.id} complaint={c} onOpenAccount={openAccount} onStatusChange={changeComplaintStatus} />
                ))}
                {hasMore && (
                    <AdmButton full onClick={() => setShown((n) => n + PAGE)} disabled={loading}>
                        {loading ? 'جارٍ التحميل…' : `عرض المزيد — ظهر ${admNum(complaints.length)} صفّاً`}
                    </AdmButton>
                )}
            </div>
        );
    } else if (view === 'suspended') {
        // v12.54 — من أُوقف (يدوياً أو تلقائياً بعد ٣ مخالفات) وأسبابه كاملة —
        // إنذارات + مخالفات مرصودة + بلاغات — حتى يقرر ناصر الرفع عن علم.
        body = suspended.length === 0 ? (
            <AdmEmpty
                icon="✅"
                title="لا حساب موقوف الآن"
                hint="أي حساب توقفه الإدارة، أو يوقفه النظام تلقائياً بعد 3 مخالفات محتوى، يظهر هنا بكل أسبابه."
            />
        ) : (
            <div style={{ display: 'grid', gap: 10 }}>
                {suspended.map((u: any) => (
                    <SuspendedCard key={u.user_id} row={u} onLift={toggleSuspend} />
                ))}
            </div>
        );
    } else {
        body = warned.length === 0 ? (
            <AdmEmpty
                icon="✅"
                title={warnFiltered ? 'لا حساب يطابق هذه المرشِّحات' : 'لا حساب عليه إنذار من الإدارة'}
                hint={warnFiltered
                    ? 'قلّل العدد الأدنى أو غيّر نوع الحساب أو امسح البحث.'
                    : 'كل إنذارٍ تصدره من «مراقبة الرسائل» يظهر هنا مع عدّاده وسببه والرسالة التي صدر عليها.'}
                action={clearAction}
            />
        ) : (
            <div style={{ display: 'grid', gap: 10 }}>
                {warned.map((w) => (
                    <WarnedUserCard
                        key={w.user_id}
                        user={w}
                        onSuspendToggle={toggleSuspend}
                        onBookingBan={bookingBan}
                        onBookingBanLift={bookingBanLift}
                    />
                ))}
            </div>
        );
    }

    const shownCount = view === 'reports' ? reports.length
        : view === 'complaints' ? complaints.length
        : view === 'warnings' ? warned.length
        : suspended.length;

    return (
        <div dir="rtl" style={{ display: 'grid', gap: 14 }}>
            <AdmPageHeader
                icon="🚩"
                title="البلاغات والشكاوى"
                desc="مركزٌ واحد لما يصل الإدارة عن المستخدمين: بلاغاتهم على بعضهم، وشكاواهم لنا، والإنذارات التي أصدرتها الإدارة، والحسابات التي أوقفتها. كل إجراءٍ هنا يدويّ ويُسجَّل."
                actions={
                    <AdmButton onClick={load} title="إعادة تحميل القائمة من قاعدة البيانات">🔄 تحديث</AdmButton>
                }
            />

            {/* منتقي العرض — اسمٌ واضح لكلٍّ منها، ووصفه يظهر فوق قائمته */}
            <nav aria-label="أقسام البلاغات" style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {VIEWS.map((v) => {
                    const on = view === v.id;
                    return (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => { setView(v.id); setStatus(''); }}
                            aria-current={on ? 'page' : undefined}
                            className="adm-focusable"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
                                fontSize: '.82rem', fontWeight: 800, whiteSpace: 'nowrap',
                                border: `1px solid ${on ? 'transparent' : 'var(--adm-border)'}`,
                                background: on ? 'var(--adm-accent)' : 'var(--adm-surface)',
                                color: on ? '#ffffff' : 'var(--adm-fg-2)',
                            }}
                        >
                            <span aria-hidden="true">{v.icon}</span>
                            {v.label}
                        </button>
                    );
                })}
            </nav>

            {stats}

            {/* المرشِّحات — قسمٌ يُطوى فلا يزاحم القائمة على شاشة الجوال */}
            {showListFilters && (
                <AdmSection
                    icon="⚙️"
                    title="البحث والمرشِّحات"
                    desc="تُطبَّق على القائمة أدناه وحدها — بطاقات الأرقام فوقها عن المنصّة كلّها."
                    collapsible
                    defaultOpen
                    badge={hasFilters ? { text: 'مرشِّحات مفعّلة', tone: 'info' } : undefined}
                    action={clearAction}
                >
                    <div style={{ display: 'grid', gap: 11 }}>
                        <input
                            type="search"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="🔎 بحث: اسم، جوال، معرّف، نصّ…"
                            aria-label="بحث"
                            className="adm-focusable"
                            style={{
                                width: '100%', padding: '9px 12px', fontSize: '.85rem', fontWeight: 600,
                                borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
                            }}
                        />

                        {view !== 'warnings' && (
                            <FilterRow label="الحالة:">
                                <FilterChip active={!status} onClick={() => setStatus('')} label="الكل" icon="•" />
                                <FilterChip active={status === 'open'} onClick={() => setStatus('open')} label="مفتوح" icon="🟠" />
                                <FilterChip
                                    active={status === (view === 'reports' ? 'under_review' : 'reviewing')}
                                    onClick={() => setStatus(view === 'reports' ? 'under_review' : 'reviewing')}
                                    label={view === 'reports' ? 'تحت المراجعة' : 'قيد المراجعة'}
                                    icon="🔴"
                                />
                                <FilterChip active={status === 'resolved'} onClick={() => setStatus('resolved')} label="تم الحل" icon="✅" />
                                <FilterChip active={status === 'dismissed'} onClick={() => setStatus('dismissed')} label="مرفوض" icon="⛔" />
                            </FilterRow>
                        )}

                        {view === 'warnings' && (
                            <>
                                <FilterRow label="الحساب:">
                                    <FilterChip active={!role} onClick={() => setRole('')} label="الكل" icon="👥" />
                                    <FilterChip active={role === 'buyer'} onClick={() => setRole('buyer')} label="مشترون" icon="🛒" />
                                    <FilterChip active={role === 'seller'} onClick={() => setRole('seller')} label="تجار" icon="🏪" />
                                </FilterRow>
                                <FilterRow label="من عدد:">
                                    <FilterChip active={warnMin === 1} onClick={() => setWarnMin(1)} label="الكل" icon="•" />
                                    <FilterChip active={warnMin === 2} onClick={() => setWarnMin(2)} label="مرتين فأكثر" icon="⚠️" />
                                    <FilterChip active={warnMin === 3} onClick={() => setWarnMin(3)} label="3 فأكثر (خطر)" icon="🔴" />
                                    <input
                                        type="number" min={1} value={warnMin}
                                        onChange={(e) => setWarnMin(Math.max(1, Number(e.target.value) || 1))}
                                        title="اكتب رقم الإنذارات — يعرض من هذا العدد فأكثر"
                                        aria-label="أقل عدد إنذارات"
                                        className="adm-focusable"
                                        style={{
                                            width: 62, padding: '5px 8px', textAlign: 'center',
                                            fontSize: '.76rem', fontWeight: 800,
                                            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                            background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
                                        }}
                                    />
                                </FilterRow>
                            </>
                        )}

                        {view === 'reports' && (
                            <>
                                <FilterRow label="النوع:">
                                    <FilterChip active={!rtype} onClick={() => setRtype('')} label="الكل" icon="•" />
                                    {REPORT_TYPES.map((t) => (
                                        <FilterChip key={t.value} active={rtype === t.value} onClick={() => setRtype(t.value)} label={t.label} icon={t.icon} />
                                    ))}
                                </FilterRow>
                                <FilterRow label="ضدّ:">
                                    <FilterChip active={!role} onClick={() => setRole('')} label="الكل" icon="👥" />
                                    <FilterChip active={role === 'seller'} onClick={() => setRole('seller')} label="تاجر" icon="🏪" />
                                    <FilterChip active={role === 'buyer'} onClick={() => setRole('buyer')} label="مشتري" icon="🛒" />
                                </FilterRow>
                                <FilterRow label="الفترة:">
                                    <FilterChip active={!days} onClick={() => setDays(0)} label="كل الفترات" icon="📅" />
                                    <FilterChip active={days === 1} onClick={() => setDays(1)} label="آخر يوم" />
                                    <FilterChip active={days === 7} onClick={() => setDays(7)} label="آخر 7 أيام" />
                                    <FilterChip active={days === 14} onClick={() => setDays(14)} label="آخر 14 يوماً" />
                                    <FilterChip active={days === 30} onClick={() => setDays(30)} label="آخر 30 يوماً" />
                                </FilterRow>
                            </>
                        )}
                    </div>
                </AdmSection>
            )}

            {/* القائمة — عنوانها ووصفها يقولان بالضبط ما هذه الأرقام */}
            <AdmSection
                icon={cur.icon}
                title={cur.label}
                desc={cur.desc}
                badge={loading ? undefined : { text: `${admNum(shownCount)} معروض`, tone: 'neutral' }}
            >
                {body}
            </AdmSection>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// بطاقة بلاغ
// ═══════════════════════════════════════════════════════════════════════════

interface ReportCardProps {
    report: AdminReportRow;
    onOpenAccount: (id: string, role: string, name?: string) => void;
    onStatusChange: (id: string, status: string) => void;
}

const ReportCard: React.FC<ReportCardProps> = ({ report: r, onOpenAccount, onStatusChange }) => {
    const typeLabel = REPORT_TYPES.find((t) => t.value === r.report_type);
    const tone = STATUS_META[r.status]?.tone ?? 'neutral';

    return (
        <div style={rowCard(tone)}>
            {/* النوع + الحالة + الوقت */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <AdmPill>{typeLabel?.icon ?? '⚠️'} {typeLabel?.label ?? r.report_type}</AdmPill>
                    <StatusPill status={r.status} />
                    {r.reported_under_review && (
                        <AdmPill tone="bad" title="النظام حوّل الحساب تلقائياً لتحت المراجعة">⚠️ الحساب تحت المراجعة</AdmPill>
                    )}
                </div>
                <Tooltip text={fmt(r.created_at)}>
                    <span style={{ ...metaText, fontVariantNumeric: 'tabular-nums' }}>{timeAgo(r.created_at)}</span>
                </Tooltip>
            </div>

            {/* الطرفان */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 11 }}>
                <PartyButton
                    label="المُبلِّغ"
                    name={r.reporter_name}
                    role={r.reporter_role}
                    extra={`${admNum(r.reporter_filed_count)} بلاغ مُقدّم`}
                    extraTooltip="عدد البلاغات التي قدّمها هذا المستخدم — كثرة الأرقام = مُبلِّغ كيدي محتمل"
                    onClick={() => onOpenAccount(r.reporter_id, r.reporter_role, r.reporter_name)}
                    icon="👤"
                />
                <span aria-hidden="true" style={{ color: 'var(--adm-fg-3)', fontWeight: 800 }}>←</span>
                <PartyButton
                    label="المُبلَّغ ضدّه"
                    name={r.reported_name}
                    role={r.reported_role}
                    extra={`${admNum(r.reported_received_count)} بلاغ مستلَم · ${admNum(r.reported_distinct_reporters)} مبلِّغ مختلف/14ي`}
                    extraTooltip="إذا تجاوز عدد المبلِّغين المختلفين 3 خلال 14 يوم، النظام يحوّل الحساب تلقائياً لتحت المراجعة"
                    onClick={() => onOpenAccount(r.reported_id, r.reported_role, r.reported_name)}
                    icon="🎯"
                    danger
                />
            </div>

            {r.reporter_phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, fontSize: '.78rem' }}>
                    <span style={metaText}>📞 جوال المبلِّغ</span>
                    <span dir="ltr" style={{ fontWeight: 800, color: 'var(--adm-fg)', fontVariantNumeric: 'tabular-nums' }}>{r.reporter_phone}</span>
                    <CopyButton value={r.reporter_phone} label="الجوال" size="xs" />
                </div>
            )}

            <div style={{ ...panelStyle, marginBottom: 10 }}>
                <div style={{ ...metaText, marginBottom: 4 }}>سبب البلاغ</div>
                <p style={bodyText}>{r.reason}</p>
            </div>

            {r.admin_note && <AdminNote text={r.admin_note} />}

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <Tooltip text="ضع الحساب تحت المراجعة — قيد على الحساب حتى ينتهي التحقيق">
                    <ToneButton tone="bad" onClick={() => onStatusChange(r.id, 'under_review')}>🔴 تحت المراجعة</ToneButton>
                </Tooltip>
                <Tooltip text="أغلق البلاغ كمحلول — اتخذت إجراء أو لا حاجة لإجراء">
                    <ToneButton tone="ok" onClick={() => onStatusChange(r.id, 'resolved')}>✅ تم الحل</ToneButton>
                </Tooltip>
                <Tooltip text="ارفض البلاغ — كيدي أو غير صحيح">
                    <ToneButton tone="neutral" onClick={() => onStatusChange(r.id, 'dismissed')}>⛔ رفض (كيدي)</ToneButton>
                </Tooltip>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// بطاقة شكوى
// ═══════════════════════════════════════════════════════════════════════════

interface ComplaintCardProps {
    complaint: AdminComplaintRow;
    onOpenAccount: (id: string, role: string, name?: string) => void;
    onStatusChange: (id: string, status: string) => void;
}

const ComplaintCard: React.FC<ComplaintCardProps> = ({ complaint: c, onOpenAccount, onStatusChange }) => {
    const tone = STATUS_META[c.status]?.tone ?? 'neutral';
    return (
        <div style={rowCard(tone)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <AdmPill>📣 {c.category}{c.subject ? ` — ${c.subject}` : ''}</AdmPill>
                    <StatusPill status={c.status} />
                </div>
                <Tooltip text={fmt(c.created_at)}>
                    <span style={{ ...metaText, fontVariantNumeric: 'tabular-nums' }}>{timeAgo(c.created_at)}</span>
                </Tooltip>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 11 }}>
                <PartyButton
                    label="من"
                    name={c.user_name}
                    role={c.user_type || '—'}
                    onClick={() => onOpenAccount(c.user_id, c.user_type === 'seller' ? 'seller' : 'buyer', c.user_name)}
                    icon="👤"
                />
                {c.user_phone && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.78rem' }}>
                        <span dir="ltr" style={{ fontWeight: 800, color: 'var(--adm-fg)', fontVariantNumeric: 'tabular-nums' }}>📞 {c.user_phone}</span>
                        <CopyButton value={c.user_phone} label="الجوال" size="xs" />
                    </span>
                )}
            </div>

            <div style={{ ...panelStyle, marginBottom: 10 }}>
                <p style={bodyText}>{c.message}</p>
            </div>

            {c.admin_note && <AdminNote text={c.admin_note} />}

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <Tooltip text="ضع الشكوى قيد المراجعة">
                    <ToneButton tone="bad" onClick={() => onStatusChange(c.id, 'reviewing')}>🔴 قيد المراجعة</ToneButton>
                </Tooltip>
                <Tooltip text="أغلق الشكوى كمحلولة">
                    <ToneButton tone="ok" onClick={() => onStatusChange(c.id, 'resolved')}>✅ تم الحل</ToneButton>
                </Tooltip>
                <Tooltip text="ارفض الشكوى">
                    <ToneButton tone="neutral" onClick={() => onStatusChange(c.id, 'dismissed')}>⛔ رفض</ToneButton>
                </Tooltip>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// عناصر البطاقات
// ═══════════════════════════════════════════════════════════════════════════

const AdminNote: React.FC<{ text: string }> = ({ text }) => (
    <div
        style={{
            background: toneBg('warn'), color: toneFg('warn'),
            borderRadius: 'var(--adm-r-sm)', padding: '9px 12px', marginBottom: 10,
        }}
    >
        <div style={{ fontSize: '.68rem', fontWeight: 800, marginBottom: 3 }}>📝 ملاحظة الإدارة</div>
        <p style={{ margin: 0, fontSize: '.78rem', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8 }}>
            {text}
        </p>
    </div>
);

const PartyButton: React.FC<{
    label: string;
    name: string;
    role: string;
    extra?: string;
    extraTooltip?: string;
    icon: string;
    danger?: boolean;
    onClick: () => void;
}> = ({ label, name, role, extra, extraTooltip, icon, danger, onClick }) => {
    const tone: Tone = danger ? 'bad' : 'info';
    return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
            <button
                type="button"
                onClick={onClick}
                className="adm-focusable"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 11px', borderRadius: 'var(--adm-r-sm)',
                    fontSize: '.78rem', fontWeight: 800, cursor: 'pointer',
                    border: '1px solid transparent',
                    background: toneBg(tone), color: toneFg(tone),
                }}
            >
                <span aria-hidden="true">{icon}</span>
                <span style={{ fontSize: '.68rem', opacity: .8 }}>{label}:</span>
                <span>{name}</span>
                <span style={{ fontSize: '.68rem', opacity: .75 }}>({role})</span>
                <span aria-hidden="true" style={{ opacity: .55 }}>→</span>
            </button>
            {extra && (
                extraTooltip ? (
                    <Tooltip text={extraTooltip}>
                        <span
                            style={{
                                ...metaText, cursor: 'help', paddingInlineStart: 4,
                                textDecoration: 'underline dotted', textUnderlineOffset: 2,
                            }}
                        >
                            {extra}
                        </span>
                    </Tooltip>
                ) : (
                    <span style={{ ...metaText, paddingInlineStart: 4 }}>{extra}</span>
                )
            )}
        </span>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// بطاقة حسابٍ أوقفته الإدارة
// ═══════════════════════════════════════════════════════════════════════════

const SuspendedCard: React.FC<{
    row: any;
    onLift: (id: string, suspend: boolean, name: string) => void;
}> = ({ row: u, onLift }) => (
    <div style={rowCard('bad')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontWeight: 800, fontSize: '.92rem', color: 'var(--adm-fg)' }}>
                    <span aria-hidden="true">{u.user_type === 'buyer' ? '🛒' : '🏪'}</span>
                    {u.name || '—'}
                    <AdmPill tone="bad">موقوف</AdmPill>
                </div>
                <div style={{ fontSize: '.74rem', color: 'var(--adm-fg-2)', marginTop: 3, fontWeight: 600 }}>
                    {u.user_type === 'seller' ? 'تاجر' : u.user_type === 'buyer' ? 'مشتري' : (u.user_type || '—')}
                    {u.phone ? ` · ${u.phone}` : ''}
                </div>
            </div>
            <ToneButton tone="ok" onClick={() => onLift(u.user_id, false, u.name || '')} title="يعود الدخول والعروض كما كانت">
                ✅ رفع الإيقاف
            </ToneButton>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
            <AdmPill tone="warn">⚠️ {admNum(Number(u.warn_count) || 0)} إنذار من الإدارة</AdmPill>
            <AdmPill tone="bad">🛡 {admNum(Number(u.flag_count) || 0)} مخالفة رصدها النظام</AdmPill>
            <AdmPill tone="info">🚩 {admNum(Number(u.report_count) || 0)} بلاغ ضدّه</AdmPill>
            <AdmPill>📣 {admNum(Number(u.complaint_count) || 0)} شكوى منه</AdmPill>
        </div>

        {Array.isArray(u.warnings) && u.warnings.length > 0 && (
            <div style={{ marginTop: 11, display: 'grid', gap: 5 }}>
                <div style={metaText}>آخر الإنذارات المسجَّلة على هذا الحساب</div>
                {u.warnings.map((wn: any, i: number) => (
                    <div
                        key={i}
                        style={{
                            ...panelStyle, padding: '7px 10px',
                            fontSize: '.76rem', fontWeight: 600, color: 'var(--adm-fg-2)',
                            display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
                        }}
                    >
                        <span title={wn.auto ? 'أصدره النظام آلياً' : 'أصدره مسؤول'} aria-hidden="true">{wn.auto ? '🤖' : '👤'}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>{wn.reason}</span>
                        <span style={metaText}>
                            {wn.at ? new Date(wn.at).toLocaleDateString('ar-SA-u-ca-gregory') : ''}
                        </span>
                    </div>
                ))}
            </div>
        )}

        {Array.isArray(u.recent_flags) && u.recent_flags.length > 0 && (
            <div style={{ marginTop: 8, fontSize: '.72rem', fontWeight: 700, color: 'var(--adm-fg-2)' }}>
                🛡 آخر ما رصده النظام:{' '}
                {u.recent_flags
                    .map((f: any) => (Array.isArray(f.matched) ? f.matched.join('، ') : ''))
                    .filter(Boolean)
                    .join(' • ') || 'صور/محتوى مرفوض'}
            </div>
        )}
    </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// بطاقة حسابٍ عليه إنذارات من الإدارة (v11.48)
// عدّادٌ، وإجراءات، وتفصيلٌ يقرأ كل إنذارٍ والرسالة التي صدر عليها.
// ═══════════════════════════════════════════════════════════════════════════

const WarnedUserCard: React.FC<{
    user: WarnedUser;
    onSuspendToggle: (id: string, suspend: boolean, name: string) => void;
    onBookingBan: (id: string, name: string) => void;
    onBookingBanLift: (id: string, name: string) => void;
}> = ({ user: w, onSuspendToggle, onBookingBan, onBookingBanLift }) => {
    const { customConfirm, customAlert } = useApp();
    const [open, setOpen] = useState(false);
    const [warnings, setWarnings] = useState<UserWarning[] | null>(null);
    const danger = w.warn_count >= 3;
    const tone: Tone = danger ? 'bad' : w.warn_count === 2 ? 'warn' : 'neutral';
    const roleLabel = w.user_type === 'seller' ? 'تاجر' : w.user_type === 'buyer' ? 'مشتري' : (w.user_type || '—');

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (next && warnings === null) setWarnings(await adminService.getUserWarnings(w.user_id));
    };

    // v12.53 — حذف يدوي: يزيل الإنذار من السجل، وإن كان إشعاره المؤجل لم يصل
    // المخالف بعدُ يُلغى إرساله نهائياً.
    const deleteWarning = async (id: string) => {
        const ok = await customConfirm('حذف هذا الإنذار نهائياً؟ إن لم يصل إشعاره للمخالف بعد فسيُلغى إرساله.');
        if (!ok) return;
        const { data, error } = await supabase.rpc('admin_delete_warning', { p_warning_id: id });
        if (error || !(data as any)?.success) { await customAlert('❌ تعذّر الحذف'); return; }
        setWarnings((prev) => (prev || []).filter((x) => x.id !== id));
    };

    return (
        <div style={rowCard(tone)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontWeight: 800, fontSize: '.92rem', color: 'var(--adm-fg)' }}>
                        <span aria-hidden="true">{w.user_type === 'buyer' ? '🛒' : '🏪'}</span>
                        {w.name || '—'}
                        {w.is_suspended && <AdmPill tone="bad">موقوف</AdmPill>}
                    </div>
                    <div style={{ fontSize: '.74rem', color: 'var(--adm-fg-2)', marginTop: 3, fontWeight: 600 }}>
                        {roleLabel}{w.phone ? ` · ${w.phone}` : ''} · آخر إنذار {timeAgo(w.last_warned_at)}
                    </div>
                </div>
                <AdmPill tone={tone}>{admNum(w.warn_count)} إنذار{danger ? ' 🔴' : ''}</AdmPill>
            </div>

            {danger && (
                <div
                    style={{
                        marginTop: 9, padding: '8px 11px', borderRadius: 'var(--adm-r-sm)',
                        background: toneBg('bad'), color: toneFg('bad'),
                        fontSize: '.76rem', fontWeight: 700,
                    }}
                >
                    ⚠️ 3 إنذارات أو أكثر — يُنصح باتخاذ إجراء (إيقاف الحساب).
                </div>
            )}

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
                <AdmButton size="sm" onClick={toggle}>
                    {open ? '▲ إخفاء التفاصيل' : '📄 اقرأ الإنذارات والرسائل'}
                </AdmButton>
                {w.is_suspended ? (
                    <ToneButton tone="ok" onClick={() => onSuspendToggle(w.user_id, false, w.name || '')} title="يعود الدخول والعروض كما كانت">
                        ✅ رفع الإيقاف
                    </ToneButton>
                ) : (
                    <ToneButton tone="bad" onClick={() => onSuspendToggle(w.user_id, true, w.name || '')} title="يمنع الدخول كلّياً وتُنهى الجلسات — ويُسجَّل السبب">
                        ⛔ إيقاف الحساب
                    </ToneButton>
                )}
                {/* v12.79 — عقوبة أخفّ من إيقاف الحساب: الحساب يبقى يعمل ولا يستطيع الحجز وحده */}
                <ToneButton tone="warn" onClick={() => onBookingBan(w.user_id, w.name || '')} title="الحساب يبقى يعمل — يُمنع من الحجز وحده للمدّة التي تكتبها">
                    ⏸️ تعليق الحجز لمدة…
                </ToneButton>
                <AdmButton size="sm" onClick={() => onBookingBanLift(w.user_id, w.name || '')}>
                    ▶️ رفع تعليق الحجز
                </AdmButton>
            </div>

            {open && (
                <div style={{ marginTop: 11, display: 'grid', gap: 8 }}>
                    {warnings === null ? (
                        <AdmSkeleton rows={2} height={56} />
                    ) : warnings.length === 0 ? (
                        <AdmEmpty
                            icon="📄"
                            title="لا تفاصيل محفوظة لهذه الإنذارات"
                            hint="العدّاد يقول إنها صدرت، لكن نصوصها غير متاحة — إنذاراتٌ قديمة سابقة لحفظ التفاصيل."
                        />
                    ) : warnings.map((wn) => (
                        <div key={wn.id} style={panelStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                <AdmPill tone="warn">⚠️ إنذار</AdmPill>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={metaText}>{fmt(wn.created_at)}{wn.admin_name ? ` · ${wn.admin_name}` : ''}</span>
                                    <ToneButton tone="bad" onClick={() => deleteWarning(wn.id)} title="يُزيله من السجل ومن عدّاد الحساب">
                                        🗑 حذف
                                    </ToneButton>
                                </span>
                            </div>
                            <p style={{ ...bodyText, marginTop: 7 }}>{wn.reason}</p>
                            {wn.context_message && (
                                <div
                                    style={{
                                        marginTop: 8, padding: '8px 11px', borderRadius: 'var(--adm-r-sm)',
                                        background: toneBg('bad'), color: toneFg('bad'),
                                    }}
                                >
                                    <div style={{ fontSize: '.68rem', fontWeight: 800, marginBottom: 3 }}>الرسالة المخالفة</div>
                                    <div style={{ fontSize: '.78rem', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8 }}>
                                        {wn.context_message}
                                    </div>
                                </div>
                            )}
                            {wn.context_barcode && (
                                <div style={{ ...metaText, marginTop: 6 }}>
                                    كود المحادثة: <span style={{ fontFamily: 'monospace' }}>{wn.context_barcode}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminReports;
