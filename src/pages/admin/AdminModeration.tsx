/**
 * AdminModeration — «🛡 رصد المحتوى الآلي» (v14.89 — أُعيد تنظيمها على نظام لوحة الإدارة)
 * ═══════════════════════════════════════════════════════════════════════════
 * قسمٌ مستقلّ تماماً عن البلاغات والشكاوى: هذه **مخالفاتٌ يرصدها النظام بنفسه**
 * (فلترةٌ لحالها) — لا تعتمد على بلاغٍ من أحد:
 *   💬 كلمة تحرّش/إساءة في محادثة حجز   ⭐ في تعليق تقييم   🏷 في اسم/وصف عرض
 *   🖼 محاولة رفع صورة غير لائقة (حجبها فلتر NSFWJS قبل وصولها للتخزين)
 *
 * الرصد النصّي يتمّ بتريغرات في قاعدة البيانات (يغطّي الموقع + بوتي تيليجرام
 * وواتساب تلقائياً) عبر قاموس `moderation_terms` القابل للإدارة من هنا.
 * البيانات عبر `admin_moderation_overview` / `admin_moderation_flags` (is_admin).
 *
 * 🔴 ما صُحِّح في v14.89 — كلمةٌ واحدة لشيئين:
 *    كان عنوان هذه الشاشة «الإنذارات»، واسمُ عرضٍ في تبويب البلاغات
 *    «الإنذارات» أيضاً — والأوّل صفوف `moderation_flags` (مخالفات محتوى)
 *    والثاني صفوف `user_warnings` (إنذاراتٌ على الحساب). رقمان مختلفان باسمٍ
 *    واحد. الآن: **«مخالفة»** لكل ما يخرج من `moderation_flags` هنا،
 *    و**«إنذار»** لما يُكتب في `user_warnings` وحده.
 *
 * 🪤 ولذلك بقيت كلمة «إنذار» في موضعين هنا عمداً — وقِيس ذلك من نصّ القاعدة
 *    لا من الاسم: `moderation_settings.warn_delay_minutes` تقرؤها ثلاث دوال
 *    (`admin_warn_user` · `taki_cancel_abuse_scan` · `taki_moderation_escalate`)
 *    وكلّها تؤجّل إشعار صفٍّ في **`user_warnings`** لا في `moderation_flags`.
 *    وفلترة الإلغاء تكتب `user_warnings` كذلك. فتسميتهما «مخالفة» كانت ستكذب.
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّجات: الألوان رموز `--adm-*` تتبع
 *    `.dark-mode`/`.light-mode`، واللون للدلالة وحدها.
 *
 * ولا تغيير في السلوك: نفس النداءات ونفس الصلاحية (`action_delete_deals`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import { CATEGORIES } from '../../data/mock';
import {
    AdmSection, AdmPageHeader,
    AdmStat, AdmStatGrid,
    AdmPill, AdmEmpty, AdmSkeleton, AdmButton,
    AdmTable,
    admNum, toneFg, toneBg,
} from '../../components/admin/ui';
import type { Tone, AdmColumn } from '../../components/admin/ui';

interface StoreRow {
    store_id: string; shop: string | null;
    flags: number; open: number;
    chat: number; rating: number; deal: number; upload: number;
    last_at: string;
}
interface FlagRow {
    id: string; kind: 'text' | 'image'; source: 'chat' | 'rating' | 'deal' | 'upload';
    store_id: string | null; offender_id: string | null; offender_name: string | null;
    content: string | null; matched: string[] | null;
    /** v14.40 — مرجع الصفّ المخالف: id العرض أو التقييم أو باركود الحجز. */
    ref_id?: string | null;
    status: 'open' | 'reviewed'; created_at: string;
}
interface TermRow { id: number; term: string; match_mode: 'word' | 'substr'; }

const SOURCE_META: Record<string, { icon: string; label: string }> = {
    chat:   { icon: '💬', label: 'محادثة حجز' },
    rating: { icon: '⭐', label: 'تعليق تقييم' },
    deal:   { icon: '🏷', label: 'اسم/وصف عرض' },
    upload: { icon: '🖼', label: 'صورة مرفوضة' },
};

/** 🪤 خارج المكوّن: كائنٌ يُبنى في كل تصيير يجعل `useCallback` يشكو نقص اعتماد. */
const CA_DEFAULTS = {
    enabled: false,
    categories: [] as string[],
    window_days: 30,
    cancel_threshold: 3,
    count_buyer_cancel: true,
    count_timeout: true,
    warn_gap_hours: 72,
    warnings_before_action: 3,
    action: 'booking_ban',
    ban_days: 7,
};

const fmtWhen = (iso: string) => {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) + ' ' +
               d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false, hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
};

const metaText: React.CSSProperties = {
    fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)',
};

const fieldStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: '.8rem', fontWeight: 700, textAlign: 'center',
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
};

const Chip: React.FC<{
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}> = ({ active, onClick, children, title }) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
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
        {children}
    </button>
);

const ToneButton: React.FC<{
    tone: Tone;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
    disabled?: boolean;
}> = ({ tone, onClick, children, title, disabled }) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={disabled}
        className="adm-focusable"
        style={{
            padding: '5px 11px', borderRadius: 'var(--adm-r-sm)',
            fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap',
            border: '1px solid transparent',
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1,
            background: toneBg(tone), color: toneFg(tone),
        }}
    >
        {children}
    </button>
);

// ═══════════════════════════════════════════════════════════════════════════

const AdminModeration: React.FC = () => {
    const { customAlert, customConfirm, customPrompt, hasPermission } = useApp();
    const canAct = hasPermission('action_delete_deals');
    const [overview, setOverview] = useState<{ total_open: number; stores: StoreRow[] } | null>(null);
    const [flags, setFlags] = useState<FlagRow[]>([]);
    const [storeFilter, setStoreFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'open' | 'reviewed' | ''>('');
    const [loading, setLoading] = useState(true);
    const [terms, setTerms] = useState<TermRow[]>([]);
    const [newTerm, setNewTerm] = useState('');
    const [newMode, setNewMode] = useState<'word' | 'substr'>('word');
    const [savingTerm, setSavingTerm] = useState(false);
    // v12.53 — تأخير وصول **الإنذار** (صفّ user_warnings) للمخالف بالدقائق
    // (٠ = فوري): يوحي بمراجعة بشرية. لا علاقة له بصفوف المخالفات نفسها.
    const [warnDelay, setWarnDelay] = useState<number>(0);
    const [savingDelay, setSavingDelay] = useState(false);
    // v12.79 — إعدادات «فلترة إلغاء الطلبات» (cancel_abuse_settings)
    const [caSettings, setCaSettings] = useState<any>(CA_DEFAULTS);
    const [savingCa, setSavingCa] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [ovRes, flRes, tRes, msRes, caRes] = await Promise.all([
            supabase.rpc('admin_moderation_overview', { p_limit: 200 }),
            supabase.rpc('admin_moderation_flags', {
                p_store: storeFilter,
                p_status: statusFilter || null,
                p_limit: 300,
            }),
            supabase.from('moderation_terms').select('*').order('term'),
            supabase.from('platform_settings').select('value').eq('key', 'moderation_settings').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'cancel_abuse_settings').maybeSingle(),
        ]);
        if (!ovRes.error && ovRes.data) setOverview(ovRes.data as any);
        if (!flRes.error && Array.isArray(flRes.data)) setFlags(flRes.data as FlagRow[]);
        if (!tRes.error && tRes.data) setTerms(tRes.data as TermRow[]);
        setWarnDelay(Number((msRes.data?.value as any)?.warn_delay_minutes) || 0);
        if (caRes.data?.value) setCaSettings({ ...CA_DEFAULTS, ...(caRes.data.value as any) });
        setLoading(false);
    }, [storeFilter, statusFilter]);
    useEffect(() => { load(); }, [load]);

    const saveWarnDelay = async () => {
        setSavingDelay(true);
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'moderation_settings',
            value: { warn_delay_minutes: Math.max(0, Math.min(1440, Math.round(warnDelay) || 0)) },
            description: 'Moderation: minutes to delay warning delivery so it feels human-reviewed (v12.53)',
            updated_at: new Date().toISOString(),
        });
        setSavingDelay(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert(warnDelay > 0
            ? `✅ من الآن: أي إنذار ترسله يُسجّل فوراً عندك، ويصل للمخالف بعد ${warnDelay} دقيقة — يوحي بأن فريقاً بشرياً راجع المخالفة.`
            : '✅ الإنذارات ستصل فوراً (بدون تأخير).');
    };

    // v12.79 — حفظ إعدادات فلترة الإلغاء (الماسح الساعي في القاعدة يقرؤها مباشرة)
    const saveCaSettings = async () => {
        setSavingCa(true);
        try {
            const { error } = await supabase.from('platform_settings').upsert({
                key: 'cancel_abuse_settings',
                value: caSettings,
                description: 'Cancel-abuse filter: thresholds/categories/action (v12.79)',
                updated_at: new Date().toISOString(),
            });
            if (error) { await customAlert('❌ ' + error.message); return; }
            await customAlert(caSettings.enabled
                ? `✅ فلترة الإلغاء مفعّلة: ${caSettings.cancel_threshold} إلغاءات خلال ${caSettings.window_days} يوماً = إنذار، وبعد ${caSettings.warnings_before_action} إنذارات ${caSettings.action === 'suspend' ? 'يوقف الحساب' : `يعلَّق الحجز ${caSettings.ban_days} أيام`}. الماسح يعمل كل ساعة.`
                : '✅ حُفظت الإعدادات والفلترة متوقفة.');
        } finally {
            setSavingCa(false);
        }
    };

    const setFlagStatus = async (f: FlagRow, status: 'open' | 'reviewed') => {
        setFlags(prev => prev.map(x => x.id === f.id ? { ...x, status } : x));
        const { error } = await supabase.rpc('admin_set_flag_status', { p_id: f.id, p_status: status });
        if (error) {
            setFlags(prev => prev.map(x => x.id === f.id ? { ...x, status: f.status } : x));
            await customAlert('❌ ' + error.message);
        }
    };

    // v12.65 (طلب ناصر) — حذف المخالفة نهائياً: تختفي من السجل ومن عدّادات
    // المتجر، وترقية الإنذار الآلي تعدّ صفوف moderation_flags — فحذفها يعيد
    // عدّ مخالفات الحساب من الصفر فعلياً.
    const deleteFlag = async (f: FlagRow) => {
        const ok = await customConfirm('🗑 حذف هذه المخالفة نهائياً؟ لن تُحسب على الحساب وسيبدأ عدّه من جديد.');
        if (!ok) return;
        const before = flags;
        setFlags(p => p.filter(x => x.id !== f.id));
        const { error } = await supabase.rpc('admin_delete_flag', { p_id: f.id });
        if (error) {
            setFlags(before);
            await customAlert('❌ ' + error.message);
        }
    };

    /**
     * v14.40 — إجراءان كانا مفقودين تماماً (طلب ناصر ٢).
     *
     * 🪤 كانت الشاشة تعرض نصّ المخالفة ولا زرّ يزيلها ولا رابط يفتحها: على
     * ناصر أن يبحث عن العرض يدوياً في المتاجر. ولو أراد حذفه فلا يستطيع —
     * سياسة الحذف على `deals` للمالك وحده.
     *
     * والعرض **يُخفى لا يُحذف** (قراره: «لا تحذف اي شيء»): `paused` تُخفيه عن
     * الجميع وتُبقي طلباته وفواتيره سليمة. والتقييم يُحذف حذفاً ناعماً.
     */
    const hideDeal = async (f: FlagRow) => {
        if (!f.ref_id) { await customAlert('⚠️ هذه المخالفة قديمة ولا تحمل مرجعاً للعرض — المخالفات الجديدة تحمله.'); return; }
        const why = await customPrompt(
            '🚫 إخفاء هذا العرض؟\n\nيختفي عن كل المشترين فوراً، وتبقى طلباته وفواتيره كما هي.\nيصل التاجر إشعار بالسبب ويُسجَّل في سجلّه.\n\nاكتب السبب:');
        if (why == null) return;
        const reason = String(why).trim();
        if (reason.length < 3) { await customAlert('⚠️ اكتب سبباً واضحاً — يصل التاجر.'); return; }
        const { data, error } = await supabase.rpc('admin_hide_deal', {
            p_deal_id: f.ref_id, p_hide: true, p_reason: reason,
        });
        if (error || !(data as any)?.ok) { await customAlert('❌ ' + (error?.message || (data as any)?.error || '')); return; }
        await customAlert('🚫 أُخفي العرض ووصل التاجر السبب.');
    };

    const removeRating = async (f: FlagRow) => {
        if (!f.ref_id) { await customAlert('⚠️ هذه المخالفة قديمة ولا تحمل مرجعاً للتقييم.'); return; }
        const why = await customPrompt('🚫 حذف هذا التقييم؟\n\nيختفي عن صفحة المتجر ويُعاد حساب المتوسط.\n\nاكتب السبب (يصل صاحبه):');
        if (why == null) return;
        const reason = String(why).trim();
        if (reason.length < 3) { await customAlert('⚠️ اكتب سبباً واضحاً.'); return; }
        const { data, error } = await supabase.rpc('admin_delete_rating', {
            p_rating_id: f.ref_id, p_reason: reason,
        });
        if (error || !(data as any)?.ok) { await customAlert('❌ ' + (error?.message || (data as any)?.error || '')); return; }
        await customAlert('🚫 حُذف التقييم ووصل صاحبه السبب.');
    };

    /** رابط مباشر إلى المحتوى المخالف نفسه — كان البحث عنه يدوياً. */
    const openContent = (f: FlagRow) => {
        if (!f.ref_id) { customAlert('⚠️ هذه المخالفة قديمة ولا تحمل مرجعاً.'); return; }
        const url = f.source === 'deal'   ? `/deal/${f.ref_id}`
                  : f.source === 'chat'   ? `/booking/${f.ref_id}`
                  : f.source === 'rating' ? (f.store_id ? `/store/${f.store_id}` : null)
                  : null;
        if (!url) { customAlert('⚠️ لا صفحة مباشرة لهذا النوع.'); return; }
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const addTerm = async () => {
        const t = newTerm.trim();
        if (!t || savingTerm) return;
        setSavingTerm(true);
        const { error } = await supabase.from('moderation_terms').insert({ term: t, match_mode: newMode });
        setSavingTerm(false);
        if (error) {
            await customAlert(error.code === '23505' ? '⚠️ هذه الكلمة موجودة أصلاً في القاموس.' : '❌ ' + error.message);
            return;
        }
        setNewTerm('');
        load();
    };

    const removeTerm = async (t: TermRow) => {
        if (!(await customConfirm(`حذف «${t.term}» من قاموس الفلترة؟`))) return;
        const { error } = await supabase.from('moderation_terms').delete().eq('id', t.id);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setTerms(prev => prev.filter(x => x.id !== t.id));
    };

    const activeStore = useMemo(
        () => (storeFilter && overview ? overview.stores.find(s => s.store_id === storeFilter) : undefined),
        [storeFilter, overview],
    );

    const storeColumns: Array<AdmColumn<StoreRow>> = useMemo(() => [
        {
            header: 'المتجر',
            cell: (s) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, color: 'var(--adm-fg)' }}>
                    {storeFilter === s.store_id && <span aria-hidden="true">✓</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.shop || s.store_id}</span>
                </span>
            ),
        },
        { header: '💬 محادثات', numeric: true, secondary: true, cell: (s) => admNum(s.chat) },
        { header: '⭐ تقييمات', numeric: true, secondary: true, cell: (s) => admNum(s.rating) },
        { header: '🏷 عروض', numeric: true, secondary: true, cell: (s) => admNum(s.deal) },
        { header: '🖼 صور مرفوضة', numeric: true, secondary: true, cell: (s) => admNum(s.upload) },
        {
            header: 'الحالة',
            cell: (s) => (
                <AdmPill tone={s.open > 0 ? 'bad' : 'ok'}>
                    {s.open > 0 ? `${admNum(s.open)} مفتوحة` : 'كلها روجعت'}
                </AdmPill>
            ),
        },
        { header: 'الإجمالي', numeric: true, cell: (s) => admNum(s.flags) },
        {
            header: 'آخر رصد', secondary: true,
            cell: (s) => <span dir="ltr" style={{ ...metaText, fontFamily: 'monospace' }}>{s.last_at ? fmtWhen(s.last_at) : '—'}</span>,
        },
    ], [storeFilter]);

    const delayBadge = warnDelay > 0
        ? (warnDelay < 60 ? `${warnDelay} دقيقة` : `${warnDelay / 60} ساعة`)
        : 'فوري';

    return (
        <div dir="rtl" style={{ display: 'grid', gap: 14 }}>
            <AdmPageHeader
                icon="🛡"
                title="رصد المحتوى الآلي"
                desc="مخالفاتٌ رصدها النظام تلقائياً في المحادثات والتقييمات والعروض والصور — بلا بلاغٍ من أحد، وفي الموقع والبوتين معاً. أمّا الإنذارات التي يصدرها فريق الإدارة على الحسابات فمكانها «إنذارات المسؤولين» في تبويب البلاغات والشكاوى."
                actions={<AdmButton onClick={load} title="إعادة قراءة المخالفات والإعدادات من قاعدة البيانات">🔄 تحديث</AdmButton>}
            />

            {loading && !overview ? (
                <AdmSkeleton rows={4} height={88} />
            ) : (
                <>
                    <AdmStatGrid cols={4}>
                        <AdmStat
                            label="مخالفات مفتوحة"
                            value={admNum(overview?.total_open ?? 0)}
                            tone={(overview?.total_open ?? 0) > 0 ? 'bad' : 'ok'}
                            icon="🛡"
                            scope="كل المنصّة"
                            title="مخالفةٌ مفتوحة = رصدها النظام ولم تُعلّمها مُراجَعة بعد"
                        />
                        <AdmStat
                            label="متاجر عليها مخالفات"
                            value={admNum(overview?.stores.length ?? 0)}
                            tone={(overview?.stores.length ?? 0) > 0 ? 'warn' : 'ok'}
                            icon="🏬"
                            scope="أعلى 200 متجر"
                        />
                        <AdmStat
                            label="المعروض في السجلّ"
                            value={admNum(flags.length)}
                            icon="📋"
                            scope="بالمرشِّحات الحالية — حتى 300 صفّ"
                        />
                        <AdmStat
                            label="كلمات قاموس الفلترة"
                            value={admNum(terms.length)}
                            icon="📖"
                            scope="القاموس الذي يرصد به النظام"
                        />
                    </AdmStatGrid>

                    {/* المخالفات لكل متجر */}
                    <AdmSection
                        icon="🏬"
                        title="المخالفات لكل متجر"
                        desc="اضغط صفّ متجرٍ لتصفية السجلّ أدناه عليه، واضغطه ثانيةً لإلغاء التصفية."
                        badge={activeStore ? { text: `مُصفّى: ${activeStore.shop || activeStore.store_id}`, tone: 'info' } : undefined}
                        action={activeStore ? <AdmButton size="sm" onClick={() => setStoreFilter(null)}>✕ كل المتاجر</AdmButton> : undefined}
                    >
                        <AdmTable<StoreRow>
                            columns={storeColumns}
                            rows={overview?.stores ?? []}
                            keyOf={(s) => s.store_id}
                            onRowClick={(s) => setStoreFilter(storeFilter === s.store_id ? null : s.store_id)}
                            caption="المخالفات المرصودة لكل متجر، مقسّمةً على مصادرها"
                            empty={{
                                icon: '✅',
                                title: 'لا مخالفة على أي متجر',
                                hint: 'لم يرصد النظام أي محتوى مخالف حتى الآن — المنصّة نظيفة.',
                            }}
                        />
                    </AdmSection>

                    {/* سجلّ المخالفات */}
                    <AdmSection
                        icon="📋"
                        title="سجلّ المخالفات"
                        desc="كل ما رصده النظام مع نصّه والكلمات التي طابقها، ومعه إجراءٌ في مكانه: فتح المحتوى، أو إخفاء العرض، أو حذف التقييم."
                        badge={{ text: `${admNum(flags.length)} معروض`, tone: 'neutral' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 13 }}>
                            <span style={metaText}>الحالة:</span>
                            {([['', 'الكل'], ['open', 'المفتوحة'], ['reviewed', 'المُراجَعة']] as const).map(([v, lbl]) => (
                                <Chip key={v} active={statusFilter === v} onClick={() => setStatusFilter(v)}>{lbl}</Chip>
                            ))}
                            {activeStore && (
                                <AdmPill tone="info">🏬 {activeStore.shop || activeStore.store_id}</AdmPill>
                            )}
                        </div>

                        {loading ? (
                            <AdmSkeleton rows={3} height={92} />
                        ) : flags.length === 0 ? (
                            <AdmEmpty
                                icon="✅"
                                title={statusFilter || storeFilter ? 'لا مخالفة تطابق هذه المرشِّحات' : 'لا مخالفات مرصودة'}
                                hint={statusFilter || storeFilter
                                    ? 'وسّع الحالة إلى «الكل» أو ألغِ تصفية المتجر.'
                                    : 'أي كلمة من القاموس تظهر في محادثة أو تقييم أو عرض، أو صورة يحجبها الفلتر، تُسجَّل هنا لحظياً.'}
                                action={(statusFilter || storeFilter)
                                    ? <AdmButton size="sm" onClick={() => { setStatusFilter(''); setStoreFilter(null); }}>✕ امسح المرشِّحات</AdmButton>
                                    : undefined}
                            />
                        ) : (
                            <div style={{ display: 'grid', gap: 9 }}>
                                {flags.map(f => {
                                    const meta = SOURCE_META[f.source] || { icon: '❔', label: f.source };
                                    const tone: Tone = f.status === 'open' ? 'bad' : 'ok';
                                    return (
                                        <div
                                            key={f.id}
                                            style={{
                                                background: 'var(--adm-surface-2)',
                                                border: '1px solid var(--adm-border)',
                                                borderInlineStartWidth: 3,
                                                borderInlineStartStyle: 'solid',
                                                borderInlineStartColor: toneFg(tone),
                                                borderRadius: 'var(--adm-r-sm)',
                                                padding: '11px 13px',
                                                display: 'grid', gap: 8,
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                                <AdmPill>{meta.icon} {meta.label}</AdmPill>
                                                {f.offender_name && (
                                                    <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--adm-fg-2)' }}>
                                                        👤 {f.offender_name}
                                                    </span>
                                                )}
                                                <span dir="ltr" style={{ ...metaText, fontFamily: 'monospace' }}>{fmtWhen(f.created_at)}</span>
                                                <AdmPill tone={tone}>{f.status === 'open' ? 'مفتوحة' : 'روجعت'}</AdmPill>
                                                <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                                                    <AdmButton
                                                        size="sm"
                                                        onClick={() => setFlagStatus(f, f.status === 'open' ? 'reviewed' : 'open')}
                                                        title={f.status === 'open' ? 'يُخرجها من عدّاد «المفتوحة» ويبقيها في السجلّ' : 'يعيدها إلى قائمة ما يحتاج نظرك'}
                                                    >
                                                        {f.status === 'open' ? '✓ اعتبرها مُراجَعة' : '↩︎ أعدها مفتوحة'}
                                                    </AdmButton>
                                                    {/* v12.65 — حذف نهائي: يصفّر عدّ مخالفات الحساب */}
                                                    <ToneButton tone="bad" onClick={() => deleteFlag(f)} title="حذفٌ نهائي — يعيد عدّ مخالفات الحساب من الصفر">
                                                        🗑 حذف
                                                    </ToneButton>
                                                </span>
                                            </div>

                                            {f.content && (
                                                <div
                                                    style={{
                                                        background: 'var(--adm-surface-3)',
                                                        border: '1px solid var(--adm-border)',
                                                        borderRadius: 'var(--adm-r-sm)',
                                                        padding: '8px 11px',
                                                        fontSize: '.8rem', lineHeight: 1.8, color: 'var(--adm-fg)',
                                                        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                                                    }}
                                                >
                                                    {f.content}
                                                </div>
                                            )}

                                            {/* v14.40 — الإجراء في مكانه: رابطٌ يفتح المحتوى، وزرّ يزيله. */}
                                            {f.ref_id && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                                    <AdmButton size="sm" onClick={() => openContent(f)} title="يفتح المحتوى المخالف نفسه في تبويب جديد">
                                                        ↗ فتح المحتوى
                                                    </AdmButton>
                                                    {canAct && f.source === 'deal' && (
                                                        <ToneButton tone="warn" onClick={() => hideDeal(f)} title="يختفي عن المشترين وتبقى طلباته وفواتيره">
                                                            🚫 إخفاء العرض
                                                        </ToneButton>
                                                    )}
                                                    {canAct && f.source === 'rating' && (
                                                        <ToneButton tone="bad" onClick={() => removeRating(f)} title="يختفي عن صفحة المتجر ويُعاد حساب المتوسط">
                                                            🚫 حذف التقييم
                                                        </ToneButton>
                                                    )}
                                                </div>
                                            )}

                                            {f.matched && f.matched.length > 0 && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                    <span style={metaText}>السبب — كلمات رُصدت:</span>
                                                    {f.matched.map((m, i) => (
                                                        <AdmPill key={i} tone="bad">{m}</AdmPill>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </AdmSection>

                    {/* ── الإعدادات: تحت البيانات لا فوقها، ومطويّةٌ وحالتُها ظاهرة ── */}

                    {/* v12.53 — «المراقبة البشرية»: تأخير وصول الإنذار للمخالف بالدقائق.
                        🪤 وهو إنذارٌ لا مخالفة: قُرئ من نصّ القاعدة — ثلاث دوال تقرأ
                        هذا المفتاح وكلّها تؤجّل إشعار صفٍّ في user_warnings. */}
                    <AdmSection
                        icon="⏱"
                        title="توقيت وصول الإنذار للمخالف"
                        desc="ينطبق على كل إنذارٍ يصل حساب المخالف: ما يصدره مسؤول يدوياً، وما يصدره النظام بعد تكرار المخالفات أو تكرار الإلغاء. وتُقرأ هذه الإنذارات وتُحذف من «إنذارات المسؤولين» في تبويب البلاغات."
                        collapsible
                        defaultOpen={false}
                        badge={{ text: delayBadge, tone: warnDelay > 0 ? 'info' : 'neutral' }}
                    >
                        <p style={{ margin: '0 0 12px', fontSize: '.8rem', fontWeight: 600, lineHeight: 1.85, color: 'var(--adm-fg-2)', maxWidth: '68ch' }}>
                            الإنذار يُسجّل في سجلّك <b>فوراً</b> ويبقى حتى تحذفه يدوياً. حدّد كم دقيقة ينتظر النظام قبل إيصال
                            الإشعار للمخالف — التأخير يوحي بأن <b>فريقاً بشرياً</b> راجع المخالفة (0 = يصل فوراً).
                            وإذا حذفت الإنذار قبل انقضاء المدة، يُلغى إرساله نهائياً.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            {[0, 10, 30, 60, 180].map(m => (
                                <Chip key={m} active={warnDelay === m} onClick={() => setWarnDelay(m)}>
                                    {m === 0 ? 'فوري' : m < 60 ? `${m} دقيقة` : `${m / 60} ساعة`}
                                </Chip>
                            ))}
                            <input
                                type="number" min={0} max={1440} value={warnDelay}
                                onChange={e => setWarnDelay(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
                                aria-label="دقائق التأخير"
                                className="adm-focusable"
                                style={{ ...fieldStyle, width: 74 }}
                            />
                            <span style={metaText}>دقيقة</span>
                            <AdmButton variant="primary" onClick={saveWarnDelay} disabled={savingDelay}>
                                {savingDelay ? '⏳ جارٍ الحفظ…' : '💾 حفظ'}
                            </AdmButton>
                        </div>
                    </AdmSection>

                    {/* v12.79 — «فلترة إلغاء الطلبات»: إنذارات آلية للمشترين الذين يحجزون
                        ويلغون/لا يستلمون، بتصنيفات وعتبات ومُهَل وعقوبة يحددها المالك.
                        الماسح يعمل كل ساعة في القاعدة (taki_cancel_abuse_scan) ويغطي
                        الويب والبوتين، وما يكتبه **إنذارات** تظهر في «إنذارات المسؤولين». */}
                    <AdmSection
                        icon="🚫"
                        title="فلترة إلغاء الطلبات (المشترون)"
                        desc="فلترةٌ آلية ثانية — لكنها لا ترصد محتوى: تعدّ الإلغاءات وعدم الاستلام، وما تكتبه إنذاراتٌ على الحساب تظهر في «إنذارات المسؤولين»، لا مخالفاتٍ في السجلّ أعلاه."
                        collapsible
                        defaultOpen={false}
                        badge={{ text: caSettings.enabled ? 'مفعّلة' : 'متوقفة', tone: caSettings.enabled ? 'ok' : 'neutral' }}
                    >
                        {/* 🪤 المفتاح داخل الجسم لا في رأس القسم: القسم يُطوى، ولو
                            كان المفتاح في الرأس لبدّله القارئ وزرُّ الحفظ مطويٌّ
                            تحته — فيظنّ أنه فعّل شيئاً ولم يُحفظ شيء. */}
                        <div
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                padding: '10px 12px', marginBottom: 13,
                                background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
                                borderRadius: 'var(--adm-r-sm)',
                            }}
                        >
                            <AdmButton
                                variant={caSettings.enabled ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => setCaSettings((p: any) => ({ ...p, enabled: !p.enabled }))}
                            >
                                {caSettings.enabled ? '🟢 مفعّلة' : '⚪ متوقفة'}
                            </AdmButton>
                            <span style={{ ...metaText, flex: 1, minWidth: 0, lineHeight: 1.7 }}>
                                التبديل لا يسري حتى تضغط «حفظ إعدادات فلترة الإلغاء» في أسفل القسم.
                            </span>
                        </div>

                        <p style={{ margin: '0 0 13px', fontSize: '.8rem', fontWeight: 600, lineHeight: 1.85, color: 'var(--adm-fg-2)', maxWidth: '68ch' }}>
                            من يحجز ثم يلغي أو لا يستلم (شكوى التاجر من عدم الحضور) في التصنيفات التي تحدّدها: يُنذَر آلياً،
                            وبعد عدد الإنذارات الذي تحدّده تُطبَّق العقوبة تلقائياً — تعليق الحجز لمدة تقرّرها أو إيقاف الحساب مباشرة.
                            ويمكنك دائماً تعليق الحجز أو إيقاف أي حساب يدوياً من «إنذارات المسؤولين» في تبويب البلاغات.
                        </p>

                        <div style={{ marginBottom: 13 }}>
                            <div style={{ ...metaText, marginBottom: 7 }}>
                                التصنيفات المشمولة (بلا تحديد = كل التصنيفات)
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                                    const on = (caSettings.categories || []).includes(c.id);
                                    return (
                                        <Chip
                                            key={c.id}
                                            active={on}
                                            onClick={() => setCaSettings((p: any) => ({
                                                ...p,
                                                categories: on
                                                    ? (p.categories || []).filter((x: string) => x !== c.id)
                                                    : [...(p.categories || []), c.id],
                                            }))}
                                        >
                                            {c.emoji} {c.ar}
                                        </Chip>
                                    );
                                })}
                            </div>
                        </div>

                        <div
                            style={{
                                display: 'grid', gap: 10, marginBottom: 13,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                            }}
                        >
                            {[
                                { k: 'cancel_threshold', label: 'عدد الإلغاءات المسموح قبل الإنذار', min: 1, max: 50 },
                                { k: 'window_days', label: 'خلال كم يوماً تُحسب الإلغاءات', min: 1, max: 365 },
                                { k: 'warn_gap_hours', label: 'المدة بين الإنذار والإنذار (ساعات)', min: 1, max: 720 },
                                { k: 'warnings_before_action', label: 'عدد الإنذارات قبل العقوبة', min: 1, max: 20 },
                                { k: 'ban_days', label: 'مدة تعليق الحجز (أيام)', min: 1, max: 365 },
                            ].map(f => (
                                <label key={f.k} style={{ display: 'block' }}>
                                    <span style={{ ...metaText, display: 'block', marginBottom: 5, lineHeight: 1.5 }}>{f.label}</span>
                                    <input
                                        type="number" min={f.min} max={f.max} value={caSettings[f.k] ?? f.min}
                                        onChange={e => setCaSettings((p: any) => ({
                                            ...p,
                                            [f.k]: Math.max(f.min, Math.min(f.max, Math.round(Number(e.target.value) || f.min))),
                                        }))}
                                        className="adm-focusable"
                                        style={{ ...fieldStyle, width: '100%' }}
                                    />
                                </label>
                            ))}
                            <label style={{ display: 'block' }}>
                                <span style={{ ...metaText, display: 'block', marginBottom: 5, lineHeight: 1.5 }}>العقوبة بعد استنفاد الإنذارات</span>
                                <select
                                    value={caSettings.action || 'booking_ban'}
                                    onChange={e => setCaSettings((p: any) => ({ ...p, action: e.target.value }))}
                                    className="adm-focusable"
                                    style={{ ...fieldStyle, width: '100%', textAlign: 'start' }}
                                >
                                    <option value="booking_ban">⏸️ تعليق الحجز للمدة أعلاه</option>
                                    <option value="suspend">⛔ إيقاف الحساب مباشرة</option>
                                </select>
                            </label>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 13 }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.78rem', fontWeight: 700, color: 'var(--adm-fg)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={caSettings.count_buyer_cancel !== false}
                                    onChange={e => setCaSettings((p: any) => ({ ...p, count_buyer_cancel: e.target.checked }))}
                                />
                                يُحسب إلغاء المشتري بنفسه
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.78rem', fontWeight: 700, color: 'var(--adm-fg)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={caSettings.count_timeout !== false}
                                    onChange={e => setCaSettings((p: any) => ({ ...p, count_timeout: e.target.checked }))}
                                />
                                يُحسب عدم الحضور (انتهاء مهلة الاستلام)
                            </label>
                        </div>

                        <AdmButton variant="primary" onClick={saveCaSettings} disabled={savingCa}>
                            {savingCa ? '⏳ جارٍ الحفظ…' : '💾 حفظ إعدادات فلترة الإلغاء'}
                        </AdmButton>
                    </AdmSection>

                    {/* قاموس الفلترة */}
                    <AdmSection
                        icon="📖"
                        title="قاموس كلمات الفلترة"
                        desc="الكلمات التي يبحث عنها النظام في المحادثات والتقييمات وأسماء العروض وأوصافها. أضف أو احذف بنفسك — يسري فوراً على الموقع والبوتين."
                        collapsible
                        defaultOpen={false}
                        badge={{ text: `${admNum(terms.length)} كلمة`, tone: 'neutral' }}
                    >
                        <div style={{ display: 'grid', gap: 12 }}>
                            <div
                                style={{
                                    background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
                                    borderRadius: 'var(--adm-r-sm)', padding: '9px 12px',
                                    fontSize: '.78rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', fontWeight: 600,
                                }}
                            >
                                <b style={{ color: 'var(--adm-fg)' }}>وضع المطابقة:</b>{' '}
                                <b>كلمة مستقلة</b> = تُرصد فقط ككلمة كاملة (آمن للكلمات القصيرة حتى لا تُرصد «مكسرات» خطأً) ·{' '}
                                <b>في أي مكان</b> = تُرصد حتى داخل كلمة أخرى (للألفاظ الصريحة التي لا ترد في كلام طبيعي).
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <input
                                    value={newTerm}
                                    onChange={e => setNewTerm(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addTerm(); }}
                                    placeholder="كلمة أو عبارة جديدة…"
                                    aria-label="كلمة جديدة"
                                    className="adm-focusable"
                                    style={{ ...fieldStyle, flex: '1 1 180px', minWidth: 0, textAlign: 'start' }}
                                />
                                <select
                                    value={newMode}
                                    onChange={e => setNewMode(e.target.value as any)}
                                    aria-label="وضع المطابقة"
                                    className="adm-focusable"
                                    style={{ ...fieldStyle, textAlign: 'start' }}
                                >
                                    <option value="word">كلمة مستقلة</option>
                                    <option value="substr">في أي مكان</option>
                                </select>
                                <AdmButton variant="primary" onClick={addTerm} disabled={savingTerm || !newTerm.trim()}>
                                    ➕ إضافة
                                </AdmButton>
                            </div>

                            {terms.length === 0 ? (
                                <AdmEmpty
                                    icon="📖"
                                    title="القاموس فارغ"
                                    hint="بلا كلماتٍ لا يرصد النظام نصّاً مخالفاً إطلاقاً — أضف كلمةً واحدة على الأقل."
                                />
                            ) : (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {terms.map(t => (
                                        <span
                                            key={t.id}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                                padding: '4px 10px', borderRadius: 999,
                                                background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
                                                fontSize: '.76rem', fontWeight: 700, color: 'var(--adm-fg)',
                                            }}
                                        >
                                            {t.term}
                                            <span style={metaText}>{t.match_mode === 'word' ? 'كلمة' : 'أي مكان'}</span>
                                            <button
                                                type="button"
                                                onClick={() => removeTerm(t)}
                                                title={`حذف «${t.term}» من القاموس`}
                                                aria-label={`حذف ${t.term}`}
                                                className="adm-focusable"
                                                style={{
                                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                                    color: 'var(--adm-bad-fg)', fontWeight: 900, fontSize: '.8rem', lineHeight: 1, padding: 0,
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </AdmSection>
                </>
            )}
        </div>
    );
};

export default AdminModeration;
