/**
 * SetupPath — مسار إعداد المتجر المرشد (v14.69)
 * ═══════════════════════════════════════════════════════════════════════════
 * يحلّ محلّ `SetupGapsBanner` (v14.45) ويبتلع كل ما فيها. اللافتة كانت تقول
 * «ينقصك شيئان» — والتاجر الجديد لا يعرف **ما الترتيب** ولا **كم بقي**، فيبدأ
 * من نموذج المنتج قبل أن يُقرّ طريقة حسابه فتخرج عروضه مسوّدات ولا يعرف لماذا.
 * قِيس على الإنتاج (٢٠ سبتمبر ٢٠٢٦): تاجرٌ من ثلاثة أنجز **صفراً** من خمس.
 *
 * ما لم يتغيّر — عمداً:
 *  • **لا زرّ إغلاق.** قرار ناصر قائم: لا إلزام، لكن التركَ يبقى ظاهراً ومكلفاً.
 *    يختفي المسار وحده حين تكتمل الخمس، لا قبل.
 *  • المصدر هو `merchant_setup_gaps` في القاعدة — نفسه الذي يقرؤه التذكير
 *    الأسبوعي، فلا تفترق شاشةٌ عن إشعار.
 *  • كل سطرٍ يقول **الأثر** لا الاسم: «عروضك تبقى مسوّدات»، «المشتري يقرأ الآن…».
 *
 * 🪤 لا تُرسم `null` حتى يصل الردّ (درس v13.61): ذلك يقفز بكل ما تحته. نقرأ
 *    آخر حالة معروفة من التخزين المحلي فنرسمها في أول إطار.
 * 🪤 وفشلٌ عابر في الشبكة **ليس** «لا نواقص»: تبقى آخر حالة معروفة كما هي.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

/** مِرساة البطاقة التي تُصلح الخطوة داخل لوحة التاجر. */
export type SetupAnchor = 'pay' | 'hours' | 'refund' | 'vat' | 'deal' | 'card';

interface Steps {
    pay: boolean;
    hours: boolean;
    refund: boolean;
    vat: boolean;
    deal: boolean;
    /** v14.71 — شعار المتجر ونبذته (بطاقته التي يراها المشتري أولاً). */
    card: boolean;
}

/** تُطلقه البطاقة التي تسدّ النقص بعد حفظٍ ناجح. */
export const SETUP_GAPS_CHANGED = 'taki:setup-gaps-changed';
export const notifySetupGapsChanged = () => {
    try { window.dispatchEvent(new Event(SETUP_GAPS_CHANGED)); } catch { /* بيئة بلا window */ }
};

const lsKey = (userId: string) => `taki_setuppath_${userId}`;
const memCache = new Map<string, Steps>();

const KEYS: Array<[keyof Steps, string]> = [
    ['pay', 'pay_declared'],
    ['card', 'profile_set'],
    ['hours', 'hours_set'],
    ['refund', 'refund_set'],
    ['vat', 'vat_answered'],
    ['deal', 'has_live_deal'],
];

/**
 * نصفا «بطاقة المتجر» (شعار · نبذة) — **تفصيلٌ اختياري**: يُقرأ إن وُجد،
 * ولا يُشترط وجوده. 🪤 لو أُضيف إلى `KEYS` لصار خادمٌ لم تصله هجرة v14.72d
 * يُخفي المسار بالكامل (الفحص كلٌّ-أو-لا-شيء) — بلا خطأ ولا سطرٍ في أي سجلّ.
 */
interface CardHalves { bio: boolean; avatar: boolean }
const halvesOf = (raw: unknown): CardHalves | null => {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    if (typeof d.bio_set !== 'boolean' || typeof d.avatar_set !== 'boolean') return null;
    return { bio: d.bio_set === true, avatar: d.avatar_set === true };
};

const parse = (raw: unknown): Steps | null => {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    // خادمٌ لم تصله هجرة v14.69 بعد: المفاتيح غائبة — لا نرسم مساراً كاذباً.
    if (KEYS.some(([, k]) => typeof d[k] !== 'boolean')) return null;
    return KEYS.reduce((acc, [field, k]) => {
        acc[field] = d[k] === true;
        return acc;
    }, {} as Steps);
};

const readCache = (userId: string): Steps | null => {
    const hit = memCache.get(userId);
    if (hit) return hit;
    try {
        const raw = localStorage.getItem(lsKey(userId));
        if (!raw) return null;
        const p = JSON.parse(raw) as Steps;
        // 🪤 v14.71 — الكاش المحفوظ قبل الخطوة السادسة يحمل خمسة حقول. لو
        // قُرئ كما هو لصار `steps.card` = undefined فتُحسب «متبقّية» أبداً
        // وتُرسم بطاقةٌ ناقصة قبل وصول الشبكة. الشرط أدناه يرفضه فيُعاد بناؤه
        // من القاعدة في أوّل قراءة — إطارٌ بلا رسم خيرٌ من إطارٍ بخبرٍ خاطئ.
        if (p && KEYS.every(([f]) => typeof p[f] === 'boolean')) { memCache.set(userId, p); return p; }
        // شكلٌ قديم: يُزال بدل أن يبقى يُرفض في كل زيارة إلى الأبد.
        localStorage.removeItem(lsKey(userId));
    } catch { /* وضع خاص أو تخزين ممتلئ — نكمل بلا كاش */ }
    return null;
};

const writeCache = (userId: string, s: Steps) => {
    memCache.set(userId, s);
    try { localStorage.setItem(lsKey(userId), JSON.stringify(s)); } catch { /* تجاهل */ }
};

const same = (a: Steps, b: Steps) => KEYS.every(([f]) => a[f] === b[f]);

/** مخفيّ بصرياً، مقروءٌ لقارئ الشاشة (لا `display:none` — تلك تُخفيه عنه أيضاً). */
const SR_ONLY: React.CSSProperties = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

const SetupPath: React.FC<{
    userId: string;
    isRTL: boolean;
    onGo: (anchor: SetupAnchor) => void;
}> = ({ userId, isRTL, onGo }) => {
    const [steps, setSteps] = useState<Steps | null>(() => readCache(userId));
    const [halves, setHalves] = useState<CardHalves | null>(null);
    // v14.72d — الطيّ مسموح **فقط** بعد إنجاز الخطوتين المكلفتين (إقرار الحساب
    // وسياسة الاسترداد). قرار ناصر «لا إلزام» يعني ألّا يُخفى ما يكلّف تركُه؛
    // أمّا من أنجزهما وبقيت عليه خطواتٌ اختيارية (شعار مثلاً) فحبسُه تحت لافتة
    // كهرمانية إلى الأبد إزعاجٌ لا إرشاد — وهو ما رفضناه للتذكير الأسبوعي.
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem(`taki_setuppath_fold_${userId}`) === '1'; } catch { return false; }
    });
    const fold = (v: boolean) => {
        setCollapsed(v);
        try { localStorage.setItem(`taki_setuppath_fold_${userId}`, v ? '1' : '0'); } catch { /* تجاهل */ }
    };

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc('my_setup_gaps');
        if (error) return;                 // فشلٌ عابر ⇐ نُبقي آخر حالة معروفة
        const next = parse(data);
        setHalves(halvesOf(data));
        if (!next) return;
        writeCache(userId, next);
        setSteps(prev => (prev && same(prev, next)) ? prev : next);
    }, [userId]);

    useEffect(() => {
        load();
        const onChanged = () => { load(); };
        window.addEventListener(SETUP_GAPS_CHANGED, onChanged);
        return () => window.removeEventListener(SETUP_GAPS_CHANGED, onChanged);
    }, [load]);

    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const rows = useMemo(() => ([
        {
            key: 'pay' as SetupAnchor,
            title: t('أقرّ طريقة حسابك', 'Declare how you get paid'),
            why: t('بدون هذا الإقرار ترفض المنصّة كل حجزٍ على متجرك، وتبقى عروضك مسوّدات لا يراها أحد.',
                   'Until you declare it, every booking on your store is refused and your deals stay drafts.'),
        },
        {
            key: 'card' as SetupAnchor,
            title: t('أكمِل بطاقة متجرك', 'Complete your store card'),
            // 🪤 النصّ يقول ما يحدث فعلاً لا ما نتمنّاه: بطاقة العرض في الرئيسية
            // تعرض **اسم** المتجر لا شعاره (قِيس: `DealCard` لا تقرأ الشعار
            // إطلاقاً). الشعار يظهر في صفحة المتجر وقائمة المتابَعات وبطاقة
            // تيليجرام. وعدٌ بأكثر من ذلك يجعل التاجر يرفع شعاراً ثم لا يراه.
            // 🪤 ويقول **أيّ نصفٍ** ينقص: الخطوة تشترط الاثنين، وصفحة المتجر
            // تعرض نصّاً جاهزاً مكان النبذة الغائبة — فتاجرٌ رفع شعاره وحده يرى
            // صفحةً تبدو مكتملة والشريطُ يصرّ أنه لم يُنجز. تناقضٌ يُفقد الشريط
            // مصداقيته كلَّها، وسطرٌ واحد يحسمه.
            why: (halves && !halves.avatar && halves.bio)
                ? t('ينقصك الشعار وحده — ونبذتك ظاهرة. بدون شعارٍ تظهر صفحتك بحرفٍ في دائرة رمادية.',
                    'Only the logo is missing — your blurb is live. Without a logo your page shows a grey initial.')
                : (halves && halves.avatar && !halves.bio)
                ? t('ينقصك النصّ وحده — وما يظهر اليوم على صفحتك نصٌّ جاهز لم تكتبه أنت.',
                    'Only the blurb is missing — what shows on your page today is boilerplate you never wrote.')
                : t('شعارك ونبذتك هما وجه متجرك في صفحته وفي قائمة متابَعات عملائك وفي بطاقته داخل تيليجرام وواتساب.',
                    'Your logo and blurb are your store’s face on its page, in your followers’ list and on its Telegram and WhatsApp cards.'),
        },
        {
            key: 'hours' as SetupAnchor,
            title: t('حدّد ساعات العمل', 'Set your opening hours'),
            why: t('المشتري لا يعرف متى يستلم، وصفحة متجرك لا تستطيع أن تقول «مفتوح الآن».',
                   'Buyers cannot tell when to collect, and your page cannot say “open now”.'),
        },
        {
            key: 'refund' as SetupAnchor,
            title: t('اكتب سياسة الاسترداد', 'Write your refund policy'),
            why: t('صفحة كل عرضٍ لك تقول للمشتري الآن: «لم يُعلن هذا المتجر سياسة استرداد».',
                   'Every deal page of yours currently tells buyers: “this store has not published a refund policy”.'),
        },
        {
            key: 'vat' as SetupAnchor,
            title: t('حدّد وضعك الضريبي', 'State your VAT status'),
            why: t('هو ما يحدّد شكل فاتورة كل طلب — وإجابة «غير مسجّل» إجابةٌ كافية.',
                   'It decides the shape of every order invoice — answering “not registered” is a complete answer.'),
        },
        {
            key: 'deal' as SetupAnchor,
            title: t('انشر عرضك الأول', 'Publish your first deal'),
            why: t('متجرٌ بلا عرضٍ حيّ لا يظهر في الرئيسية ولا في «حولي».',
                   'A store with no live deal appears neither on the home feed nor in “Nearby”.'),
        },
    ]), [isRTL]);

    if (!steps) return null;
    const done = rows.filter(r => steps[r.key as keyof Steps]).length;
    if (done === rows.length) return null;   // اكتمل ⇒ يختفي وحده

    const pct = Math.round((done / rows.length) * 100);
    const align = isRTL ? 'right' : 'left';
    // الطيّ لا يُعرض ولا يسري ما دامت خطوةٌ مكلفة مفتوحة.
    const mayFold = steps.pay && steps.refund;
    const folded = mayFold && collapsed;

    return (
        <section
            aria-label={t('مسار إعداد المتجر', 'Store setup path')}
            style={{
                marginBottom: 16, padding: '16px 16px 14px', borderRadius: 18,
                border: '1.5px solid rgba(245,158,11,0.45)',
                background: 'rgba(245,158,11,0.10)',
                display: 'flex', flexDirection: 'column', gap: 12, textAlign: align,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.15rem' }} aria-hidden="true">🧭</span>
                <span style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {t('جهّز متجرك للبيع', 'Get your store ready to sell')}
                </span>
                <span
                    style={{
                        marginInlineStart: 'auto', fontWeight: 900, fontSize: '0.8rem',
                        color: '#b45309', background: 'rgba(245,158,11,0.18)',
                        borderRadius: 999, padding: '3px 12px', whiteSpace: 'nowrap',
                    }}
                >
                    {t(`أنجزتَ ${done} من ${rows.length}`, `${done} of ${rows.length} done`)}
                </span>
                {mayFold && (
                    <button
                        type="button"
                        onClick={() => fold(!folded)}
                        aria-expanded={!folded}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: '#b45309', fontWeight: 900, fontSize: '0.78rem',
                            fontFamily: 'inherit', padding: '4px 8px', minHeight: 32,
                        }}
                    >
                        {folded ? t('عرض الخطوات ▾', 'Show steps ▾') : t('طيّ ▴', 'Collapse ▴')}
                    </button>
                )}
            </div>

            {/* شريط تقدّم — يحمل قيمته لقارئ الشاشة أيضاً، لا لوناً فقط */}
            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={rows.length}
                aria-valuenow={done}
                aria-valuetext={t(`أنجزتَ ${done} من ${rows.length}`, `${done} of ${rows.length} done`)}
                style={{ height: 8, borderRadius: 999, background: 'rgba(180,83,9,0.18)', overflow: 'hidden' }}
            >
                <div style={{ width: `${pct}%`, height: '100%', background: '#b45309', borderRadius: 999, transition: 'width .3s ease' }} />
            </div>

            {!folded && (
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r, i) => {
                    const ok = steps[r.key as keyof Steps];
                    return (
                        <li
                            key={r.key}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '9px 10px', borderRadius: 12,
                                background: ok ? 'transparent' : 'var(--card-bg)',
                                border: ok ? '1px dashed rgba(180,83,9,0.25)' : '1px solid var(--border-color)',
                                opacity: ok ? 0.65 : 1,
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.75rem', fontWeight: 900,
                                    background: ok ? '#15803d' : 'rgba(180,83,9,0.15)',
                                    color: ok ? '#fff' : '#b45309',
                                }}
                            >
                                {ok ? '✓' : i + 1}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 900, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                                    {/* حالة الخطوة لقارئ الشاشة: العلامة ✓ مخفيّة عنه عمداً
                                        (aria-hidden) فلولا هذا السطر لسمع العناوين بلا حالة. */}
                                    <span style={SR_ONLY}>{ok ? t('مكتملة: ', 'Done: ') : t('متبقّية: ', 'To do: ')}</span>
                                    {r.title}
                                </div>
                                {!ok && (
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.75, color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {r.why}
                                    </div>
                                )}
                            </div>
                            {!ok && (
                                <button
                                    type="button"
                                    onClick={() => onGo(r.key)}
                                    aria-label={t(`أكمِل: ${r.title}`, `Go to: ${r.title}`)}
                                    style={{
                                        flex: '0 0 auto', padding: '8px 14px', borderRadius: 10, border: 'none',
                                        cursor: 'pointer', background: '#b45309', color: '#fff',
                                        fontWeight: 900, fontSize: '0.75rem', fontFamily: 'inherit',
                                        minHeight: 36,
                                    }}
                                >
                                    {t('أكمِل ←', 'Go →')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ol>
            )}
        </section>
    );
};

export default SetupPath;
