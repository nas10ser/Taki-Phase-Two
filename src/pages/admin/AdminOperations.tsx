/**
 * AdminOperations — إدارة العمليات (v14.99)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «لا أريد للأدمن أن يصله إشعار في الإشعارات عن أي عملية تتم،
 * وإنما ضعها في إدارة العمليات في لوحة التحكّم **برقم الكود** … وأيضاً في
 * لوحة الأدمن **كرقم مرجع**».
 *
 * ولذلك الصفُّ هنا **يبدأ بالرقم** لا بالوصف: هو أوّل ما تقرأ العين وأوّل ما
 * تُمسك اليد (زرّ نسخٍ بجانبه)، لأنه الرقم نفسه الذي يقوله المشتري عند
 * الاستلام، وتحمله الفاتورة، ويقرؤه ماسحُ التاجر. أما «ماذا جرى ومن ومتى»
 * فتفصيلٌ يأتي بعده.
 *
 * ── لماذا هذه الشاشة أصلاً ────────────────────────────────────────────────
 * قِيس قبل البناء: ٢٤٠ إشعاراً إدارياً من نوع `booking` في الجرس على ٨٩ حجزاً
 * — لأن المشغّل كان يُدخل صفّاً **لكل حساب أدمن** عند كل حدث. فجرسٌ بهذا
 * الضجيج لا يُقرأ، وما يحتاج قراراً حقيقياً (شكوى · بلاغ · توثيق) يغرق فيه.
 * الآن: الجرس للقرارات، وهذه الشاشة للعمليات.
 *
 * 🪤 والأرقام فوق **عن السجلّ كلّه ولا تتأثّر بالمرشِّح** الذي يحكم القائمة
 *    تحتها — وكلُّ بطاقةٍ تقول نطاقها صراحةً (درس v14.33: «ظهر ٥٠ من ٤١٢»
 *    كان يقارن مُرشَّحاً بغير مُرشَّح).
 * 🪤 و«اليوم» بتوقيت الرياض لا UTC: خادم جدّة على `+03:00`، ومنتصفُ ليل
 *    UTC هو الثالثة فجراً عندنا — فثلاث ساعاتٍ من عمليات الليل كانت ستُحسب
 *    على اليوم التالي.
 * 🪤 والتاريخ بـ`-u-ca-gregory` إلزاماً: `ar-SA` وحدها تُخرجه هجرياً.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AdmSection, AdmStat, AdmStatGrid, AdmPill, AdmEmpty, AdmSkeleton,
    AdmButton, AdmError, AdmSearch, admNum, admMoney,
} from '../../components/admin/ui';
import { StuckRefunds } from '../../components/admin/StuckRefunds';
import { CopyButton } from '../../components/admin/CopyButton';
import {
    operationsRepository, actionMeta, ACTOR_AR, BOOKING_ACTIONS,
} from '../../repositories/operationsRepository';
import type { OperationRow, OperationStats } from '../../repositories/operationsRepository';
import { arCount } from '../../utils/arPlural';
import type { ArForms } from '../../utils/arPlural';

const PAGE = 30;

/** 🪤 «٣ عملية» خطأ و«عمليتان» صواب — لا يُصاغ عددٌ بيدٍ أبداً (v14.92). */
const OPERATIONS: ArForms = {
    one: 'عملية واحدة', two: 'عمليتان', twoGen: 'عمليتين', few: 'عمليات', many: 'عملية',
};

/** «٢٧ سبتمبر، ٤:١٢ م» — ميلاديّ بأرقامٍ لاتينية كبقيّة اللوحة. */
const when = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });
};

const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 11px', borderRadius: 999,
    fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
    border: `1px solid ${active ? 'transparent' : 'var(--adm-border)'}`,
    background: active ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
    color: active ? '#ffffff' : 'var(--adm-fg-2)',
});

const rowCard: React.CSSProperties = {
    background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)', padding: '12px 13px',
    display: 'grid', gap: 7,
};

/** الرقم نفسه: كبيرٌ، لاتينيّ الاتجاه، بأرقامٍ متساوية العرض فتُقرأ رقماً رقماً. */
const codeStyle: React.CSSProperties = {
    fontSize: '1.05rem', fontWeight: 900, letterSpacing: '.04em',
    fontVariantNumeric: 'tabular-nums', color: 'var(--adm-fg)',
    wordBreak: 'break-all',
};

const AdminOperations: React.FC = () => {
    const [rows, setRows] = useState<OperationRow[]>([]);
    const [stats, setStats] = useState<OperationStats | null>(null);
    const [action, setAction] = useState<string | null>(null);
    const [qInput, setQInput] = useState('');
    const [q, setQ] = useState('');
    const [cursor, setCursor] = useState<{ at: string; id: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [more, setMore] = useState(false);
    const [err, setErr] = useState('');

    // بحثٌ مؤجَّل: الكتابةُ لا تُطلق نداءً لكل حرف.
    useEffect(() => {
        const t = window.setTimeout(() => setQ(qInput.trim()), 350);
        return () => window.clearTimeout(t);
    }, [qInput]);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        const res = await operationsRepository.list({ limit: PAGE, action, q });
        if (!res.ok) {
            setErr(res.msg || 'تعذّر جلب سجلّ العمليات من الخادم.');
            setRows([]); setCursor(null);
        } else {
            setRows(res.rows || []);
            setCursor(res.nextCursor && res.nextCursorId != null
                ? { at: res.nextCursor, id: res.nextCursorId } : null);
            // الأرقام تصل مع الصفحة الأولى وحدها، وتبقى حتى التحديث التالي.
            if (res.stats) setStats(res.stats);
        }
        setLoading(false);
    }, [action, q]);

    useEffect(() => { load(); }, [load]);

    const loadMore = async () => {
        if (!cursor || more) return;
        setMore(true);
        const res = await operationsRepository.list({
            limit: PAGE, action, q, cursor: cursor.at, cursorId: cursor.id,
        });
        setMore(false);
        if (!res.ok) { setErr(res.msg || 'تعذّر جلب بقيّة السجلّ.'); return; }
        // 🪤 الدمجُ بالهويّة لا بالإلحاق الأعمى: مؤشّرٌ على لحظةٍ مشتركة قد
        //    يُعيد صفّاً رأيناه، فيبدو السجلّ أطول مما هو.
        setRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            return [...prev, ...(res.rows || []).filter((r) => !seen.has(r.id))];
        });
        setCursor(res.nextCursor && res.nextCursorId != null
            ? { at: res.nextCursor, id: res.nextCursorId } : null);
    };

    /**
     * المرشِّحات من **ما في السجلّ فعلاً** لا من قائمةٍ مكتوبة: فعلٌ لا صفَّ
     * له لا يُعرض زرّاً يُفضي إلى فراغ، وفعلٌ جديدٌ تكتبه القاعدة يظهر بلا نشر.
     */
    const chips = useMemo(() => {
        const present = (stats?.actions || []).map((a) => a.action);
        const first = BOOKING_ACTIONS.filter((a) => present.includes(a));
        const rest = present.filter((a) => !first.includes(a as any)).sort();
        return [...first, ...rest];
    }, [stats]);

    const countOf = (a: string) => (stats?.actions || []).find((x) => x.action === a)?.n ?? 0;

    // ── الأرقام ──────────────────────────────────────────────────────────
    const statsBlock = (
        <AdmStatGrid cols={3}>
            <AdmStat
                label="عمليات اليوم"
                value={admNum(stats?.today ?? 0)}
                tone={(stats?.today ?? 0) > 0 ? 'info' : 'neutral'}
                icon="📅"
                scope="كل السجلّ — منذ منتصف ليل الرياض، لا يتأثّر بالمرشِّح"
                title="كل ما جرى على المنصّة اليوم: حجزٌ أو إتمام بيعٍ أو إلغاء. هذا الرقم لا يعني عملاً ينتظرك — هو مقياس حركة."
            />
            <AdmStat
                label="آخر سبعة أيام"
                value={admNum(stats?.week ?? 0)}
                tone="neutral"
                icon="📈"
                scope="كل السجلّ — سبعة أيام متدحرجة بما فيها اليوم"
                title="قارنه بـ«عمليات اليوم» لتعرف إن كان اليوم أعلى أو أدنى من معدّل الأسبوع."
            />
            <AdmStat
                label="أحدث رقم مرجع"
                value={stats?.latestCode || '—'}
                tone={stats?.latestCode ? 'ok' : 'neutral'}
                icon="🔖"
                scope={stats?.latestCode ? when(stats.latestAt) : 'لا عملية في السجلّ بعد'}
                title="رقم آخر طلبٍ دخل السجلّ. هو نفسه رقم الطلب الذي يقوله المشتري عند الاستلام وتحمله فاتورته."
            />
        </AdmStatGrid>
    );

    // ── السجلّ ───────────────────────────────────────────────────────────
    let body: React.ReactNode;
    if (loading) {
        body = <AdmSkeleton rows={5} height={92} />;
    } else if (err) {
        body = <AdmError message={err} onRetry={load} />;
    } else if (rows.length === 0) {
        const filtered = action !== null || q !== '';
        body = (
            <AdmEmpty
                icon={filtered ? '🔎' : '🗒'}
                title={
                    q !== '' ? `لا عملية بالرقم أو الاسم «${q}»`
                        : action !== null ? `لا عملية من نوع «${actionMeta(action).ar}»`
                            : 'السجلّ فارغ'
                }
                hint={
                    filtered
                        ? 'الرقم يُكتب كما هو على الطلب أو الفاتورة. وإن كنت تبحث باسم متجرٍ أو مشترٍ فاكتب جزءاً منه — البحث يتجاهل «الـ» واختلاف الهمزات.'
                        : 'كل حجزٍ جديد وكل إتمام بيعٍ وكل إلغاء يُكتب هنا لحظة وقوعه برقم مرجعه. وما دام فارغاً فلم تقع عمليةٌ بعد — ولم يعد شيءٌ من هذا يصل جرس الإشعارات.'
                }
                action={filtered
                    ? <AdmButton size="sm" onClick={() => { setAction(null); setQInput(''); }}>إلغاء المرشِّحات</AdmButton>
                    : undefined}
            />
        );
    } else {
        body = (
            <div style={{ display: 'grid', gap: 10 }}>
                {rows.map((r) => {
                    const m = actionMeta(r.action);
                    const isBooking = r.entityType === 'booking';
                    const who = r.actorName
                        || (r.actorType ? ACTOR_AR[r.actorType] || r.actorType : null);
                    return (
                        <div key={r.id} style={rowCard}>
                            {/* ① الرقم أوّلاً — هو المرجع الذي يُقال ويُبحث به */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                                    {isBooking ? 'رقم المرجع' : 'المعرّف'}
                                </span>
                                <span dir="ltr" style={codeStyle}>{r.code || '—'}</span>
                                {r.code && <CopyButton value={r.code} label="رقم المرجع" size="xs" />}
                                <span style={{ flex: 1 }} />
                                <AdmPill tone={m.tone}>{m.icon} {m.ar}</AdmPill>
                            </div>

                            {/* ② ماذا جرى ومن قام به */}
                            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--adm-fg-2)', lineHeight: 1.8, wordBreak: 'break-word' }}>
                                {r.storeName && <>المتجر: {r.storeName}</>}
                                {r.storeName && r.buyerName && ' · '}
                                {r.buyerName && <>المشتري: {r.buyerName}</>}
                                {!r.storeName && !r.buyerName && who && <>{who}</>}
                                {!r.storeName && !r.buyerName && !who && <>—</>}
                            </div>

                            {/* ③ الكمّية والمبلغ والوقت */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '.74rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                                {r.quantity !== null && <span>الكمّية: {admNum(r.quantity)}</span>}
                                {r.amount !== null && <span>الإجمالي: {admMoney(r.amount)}</span>}
                                {who && (r.storeName || r.buyerName) && (
                                    <span>
                                        بواسطة: {r.actorType ? ACTOR_AR[r.actorType] || r.actorType : who}
                                    </span>
                                )}
                                <span style={{ flex: 1 }} />
                                <span>{when(r.at)}</span>
                            </div>
                        </div>
                    );
                })}

                {cursor && (
                    <AdmButton variant="secondary" full disabled={more} onClick={loadMore}
                        title="يجلب الصفحة التالية بمؤشّرٍ مركَّب (اللحظة + الرقم) فلا يسقط صفٌّ بين صفحتين">
                        {more ? 'جارٍ الجلب…' : `عرض المزيد — ظهر ${arCount(rows.length, OPERATIONS)}`}
                    </AdmButton>
                )}
            </div>
        );
    }

    return (
        <div dir="rtl" style={{ display: 'grid', gap: 14 }}>
            {/* v15.00 — يسبق كلَّ شيء لأنه الوحيد الذي فيه مالٌ معلَّق وتاجرٌ
                ينتظر. ولا يُرسم إطلاقاً حين لا استردادَ عالقاً. */}
            <StuckRefunds />
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <p style={{ flex: '1 1 260px', margin: 0, fontSize: '.85rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                    كل عمليةٍ تجري على المنصّة تُسجَّل هنا برقم مرجعها — وهو رقم الطلب نفسه الذي
                    يقوله المشتري عند الاستلام. ولم يعد أيٌّ من هذا يصل جرس الإشعارات: الجرس
                    للقرارات التي تنتظرك (شكوى · بلاغ · توثيق)، وهذه الشاشة لما جرى.
                </p>
                <AdmButton onClick={load} title="إعادة جلب السجلّ والعدّادات من قاعدة البيانات">🔄 تحديث</AdmButton>
            </div>

            {statsBlock}

            <AdmSection
                icon="🗒"
                title="سجلّ العمليات"
                desc="المرشِّح والبحث يحكمان هذه القائمة وحدها — والأرقام فوقها عن السجلّ كلّه. ابحث برقم الطلب لتصل إليه مباشرة."
                badge={loading ? undefined : { text: arCount(rows.length, OPERATIONS), tone: 'neutral' }}
            >
                <div style={{ display: 'grid', gap: 12 }}>
                    <AdmSearch
                        value={qInput}
                        onChange={setQInput}
                        label="بحث في سجلّ العمليات"
                        placeholder="رقم الطلب، أو اسم متجرٍ أو مشترٍ…"
                    />

                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setAction(null)} aria-pressed={action === null}
                            className="adm-focusable" style={chipStyle(action === null)}>
                            <span aria-hidden="true">•</span> الكل
                            {stats && <> ({admNum(stats.total)})</>}
                        </button>
                        {chips.map((a) => {
                            const m = actionMeta(a);
                            return (
                                <button key={a} type="button" onClick={() => setAction(a)} aria-pressed={action === a}
                                    className="adm-focusable" style={chipStyle(action === a)}>
                                    <span aria-hidden="true">{m.icon}</span> {m.ar} ({admNum(countOf(a))})
                                </button>
                            );
                        })}
                    </div>

                    {body}
                </div>
            </AdmSection>
        </div>
    );
};

export default AdminOperations;
