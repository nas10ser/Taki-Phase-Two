/**
 * StockLinkCard — اربط مخزون تاكي بنظامك (v15.10 · الدرجة ١)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «ربط مباشر بكل الأنظمة الموجودة … ينقص بشكل أوتوماتيكي … ويستطيع
 * ربطها بكود أو رابط أو موقع … ولها تصنيف في موقعي».
 *
 * 🔴 وما تقوله هذه الشاشة للتاجر بصراحة، ولا تُخفيه:
 *    تاكي **لا تتكامل مسبقاً** مع كلّ نظام. عندها عقدٌ واحد مفتوح يتكلّمه أيُّ
 *    نظام، وكتالوجٌ يدلّ على الشائع منها، ووسمٌ صريح لما لم نفتح وثيقته.
 *    ومن يَعِد التاجر بتكاملٍ جاهزٍ مع نظامه دون أن يفتح وثيقته يَعِده بما
 *    لا يُنفَّذ — وهو الفخُّ المسجَّل في v14.82.
 *
 * 🪤 والمفتاح يُعرض **مرّةً واحدة**: لا يُخزَّن عندنا أصلاً (sha256 وlast4)،
 *    فمن فقده لا يستعيده — يُدوّره. والشاشة تقول ذلك قبل أن يُغلق النافذة،
 *    لا بعدها.
 *
 * 🪤 وكلُّ حالةٍ تُنتجها هذه الشاشة لها مخرجٌ بضغطة: إطفاءٌ وتدويرٌ وفكُّ ربطٍ
 *    وحذف. شاشةٌ تُنشئ ولا تُلغي تترك التاجر أمام حالةٍ بلا مخرج.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { logger } from '../../utils/logger';
import {
    PROVIDER_SEGMENTS, PROVIDER_SYSTEMS, providersOfSegment,
    type ProviderSegment, type ProviderDef,
} from '../../data/stockProviders';

interface Integration {
    id: string; provider: string; segment: string | null; label: string | null;
    api_key_last4: string; webhook_url: string | null; direction: string;
    is_enabled: boolean; last_seen_at: string | null; created_at: string;
    field_map: { id?: string; qty?: string } | null;
    last_payload: unknown; last_payload_at: string | null; last_note: string | null;
}
interface LinkRow {
    id: number; deal_id: string; variant_id: string | null; location_id: string | null;
    external_id: string;
}
interface SellerDeal {
    id: string; item_name: string;
    variants: Array<{ id: string; label?: string }> | null;
    locations: Array<{ id: string; name?: string }> | null;
    loc_qty_mode: string | null;
}

const ENDPOINT = 'https://api.takisa.net/rest/v1/rpc/taki_stock_push';
/**
 * 🔴 الرابطُ الذي **نُعطيه** للتاجر ليلصقه في نظامه (v15.12).
 * واعتراضُ ناصر هو سببُ وجوده: «لم أفهم سبب طلبك للرابط وأيّ رابط تقصد».
 * وكان محقّاً — الأنظمةُ تُرسل ولا تستقبل، فالعنوانُ يُعطى لا يُطلب.
 * 🪤 والمفتاح في الرابط لأن أغلب الأنظمة لا تسمح للتاجر بإضافة ترويسة؛
 *    والتخفيف أنه يُدوَّر بضغطة من هذه الشاشة نفسها.
 */
const HOOK = (key: string) => `https://api.takisa.net/functions/v1/stock-webhook?k=${key}`;

const box: React.CSSProperties = {
    marginTop: 14, padding: 14, borderRadius: 14,
    border: '1px solid var(--border-color)', background: 'var(--card-bg)',
};
const field: React.CSSProperties = {
    width: '100%', padding: 10, borderRadius: 10, fontSize: '0.8rem',
    border: '1px solid var(--border-color)', background: 'var(--body-bg)',
    color: 'var(--text-primary)',
};
const btn = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '9px 14px', borderRadius: 10, fontWeight: 900, fontSize: '0.78rem',
    cursor: 'pointer', border: `1px solid ${danger ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'}`,
    background: danger ? 'rgba(239,68,68,0.12)' : primary ? 'var(--primary)' : 'var(--card-bg)',
    color: danger ? '#ef4444' : primary ? '#fff' : 'var(--text-primary)',
});

/** نسخٌ بضغطة، بارتدادٍ لمتصفّحات لا تملك الحافظة الآمنة. */
const Copy: React.FC<{ value: string; label: string }> = ({ value, label }) => {
    const [done, setDone] = useState(false);
    return (
        <button type="button" style={{ ...btn(), padding: '5px 10px', fontSize: '0.72rem' }}
            onClick={async () => {
                try { await navigator.clipboard.writeText(value); }
                catch {
                    // 🪤 الحافظةُ الآمنة تحتاج سياقاً آمناً وإذناً — وبعض متصفّحات
                    //    آيفون داخل التطبيقات ترفضها بصمت. فالارتدادُ ضروري.
                    const t = document.createElement('textarea');
                    t.value = value; document.body.appendChild(t); t.select();
                    try { document.execCommand('copy'); } finally { document.body.removeChild(t); }
                }
                setDone(true); setTimeout(() => setDone(false), 1500);
            }}>{done ? '✓' : `📋 ${label}`}</button>
    );
};

export const StockLinkCard: React.FC = () => {
    const { user, language, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [integ, setInteg] = useState<Integration | null | undefined>(undefined); // undefined = يُحمَّل
    const [links, setLinks] = useState<LinkRow[]>([]);
    const [deals, setDeals] = useState<SellerDeal[]>([]);
    const [busy, setBusy] = useState(false);
    const [freshKey, setFreshKey] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    // نموذجُ الإنشاء
    const [segment, setSegment] = useState<ProviderSegment>('retail');
    const [provider, setProvider] = useState('custom');
    const [hook, setHook] = useState('');

    // نموذجُ الربط
    const [dealId, setDealId] = useState('');
    const [variantId, setVariantId] = useState('');
    const [locationId, setLocationId] = useState('');
    const [extId, setExtId] = useState('');
    const [mapId, setMapId] = useState('');
    const [mapQty, setMapQty] = useState('');

    const load = useCallback(async () => {
        if (!user?.id) return;
        const { data, error } = await supabase
            .from('stock_integrations')
            .select('id, provider, segment, label, api_key_last4, webhook_url, direction, is_enabled, last_seen_at, created_at, field_map, last_payload, last_payload_at, last_note')
            .eq('store_id', user.id).order('created_at').limit(1);
        if (error) { logger.warn('integrations read:', error.message); setInteg(null); return; }
        const row = (data || [])[0] as Integration | undefined;
        setInteg(row || null);
        if (row) {
            const [l, d] = await Promise.all([
                supabase.from('stock_links')
                    .select('id, deal_id, variant_id, location_id, external_id')
                    .eq('integration_id', row.id).order('id'),
                supabase.from('deals')
                    .select('id, item_name, variants, locations, loc_qty_mode')
                    .eq('store_id', user.id).neq('status', 'deleted').order('created_at', { ascending: false }).limit(60),
            ]);
            setLinks((l.data || []) as LinkRow[]);
            setDeals((d.data || []) as SellerDeal[]);
        }
    }, [user?.id]);

    useEffect(() => { load(); }, [load]);

    const providers = useMemo(() => providersOfSegment(segment), [segment]);
    const provDefOf = (id: string) => PROVIDER_SYSTEMS.find(p => p.id === id);
    const segDef = useMemo(() => PROVIDER_SEGMENTS.find(s => s.id === segment), [segment]);
    const provDef = useMemo<ProviderDef | undefined>(
        () => PROVIDER_SYSTEMS.find(p => p.id === provider), [provider]);
    const selectedDeal = useMemo(() => deals.find(d => d.id === dealId), [deals, dealId]);

    // 🪤 كتابةٌ ترفضها RLS تعود `error=null` — فلا يُقال «تمّ» إلا بدليلٍ من الردّ.
    const call = async (fn: string, args: Record<string, unknown>): Promise<any | null> => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { await customAlert('❌ ' + error.message); return null; }
        if (!(data as any)?.ok) {
            await customAlert('❌ ' + ((data as any)?.error || t('لم يُحفظ — حدّث الصفحة وحاول مجدداً.', 'Not saved — refresh and retry.')));
            return null;
        }
        return data;
    };

    const create = async () => {
        if (busy) return;
        setBusy(true);
        const d = await call('merchant_create_integration', {
            p_provider: provider, p_segment: segment,
            p_label: provDef ? (isRTL ? provDef.nameAr : provDef.nameEn) : null,
            p_webhook_url: hook.trim() || null,
        });
        setBusy(false);
        if (!d) return;
        setFreshKey(d.api_key as string);
        await load();
    };

    const linkProduct = async () => {
        if (busy || !integ) return;
        if (!dealId || !extId.trim()) {
            await customAlert(t('⚠️ اختر العرض واكتب الكود في نظامك.', '⚠️ Pick the deal and enter the code in your system.'));
            return;
        }
        setBusy(true);
        const d = await call('merchant_link_product', {
            p_integration_id: integ.id, p_deal_id: dealId, p_external_id: extId.trim(),
            p_variant_id: variantId || null, p_location_id: locationId || null,
            // 🔴 v15.14 — حُذف حقلُ «رابط المنتج عندهم»: قِيس فلم تقرأه دالّةٌ
            //    واحدة ولا شاشة. حقلٌ نطلبه ولا نستعمله يُربك التاجر بلا مقابل،
            //    واعتراضُ ناصر («أيّ رابط تقصد؟») كان عنه بالضبط. يُمرَّر NULL.
            p_external_url: null,
        });
        setBusy(false);
        if (!d) return;
        setExtId(''); setVariantId(''); setLocationId('');
        await load();
    };

    if (!user?.id || integ === undefined) return null;

    // ── ① المفتاح لحظةَ إصداره — مرّةً واحدة ولا رجعة ─────────────────────
    if (freshKey) {
        const sample = JSON.stringify({
            p_key: freshKey, p_event_id: 'unique-per-push',
            p_observed_at: new Date().toISOString(),
            p_items: [{ external_id: 'SKU-123', on_hand: 20 }],
        }, null, 2);
        return (
            <div style={{ ...box, border: '1px solid var(--primary)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                    🔑 {t('مفتاحك — انسخه الآن', 'Your key — copy it now')}
                </div>
                <div style={{ fontSize: '0.76rem', lineHeight: 1.9, color: 'var(--danger, #ef4444)', fontWeight: 800, marginBottom: 10 }}>
                    {t('⚠️ لن يظهر مرّةً أخرى. تاكي لا تحتفظ به — تحفظ بصمتَه فقط، فلا تستطيع استرجاعه لك. إن ضاع، دوّره من هنا واحصل على غيره.',
                       '⚠️ This will not be shown again. TAKI stores only its fingerprint, so it cannot be retrieved. If lost, rotate it here for a new one.')}
                </div>
                <div style={{ ...field, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>{freshKey}</div>
                {/* 🔴 الأهمُّ أوّلاً: الرابطُ الجاهز الذي يلصقه التاجر — لا المفتاح. */}
                <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
                    📎 {provDef && provDef.selfServeWebhook === 'yes'
                        ? t('والأهمّ: هذا رابطك — الصقه في نظامك', 'Most important: this is your URL — paste it into your system')
                        : t('هذا رابطك — احتفظ به', 'This is your URL — keep it')}
                </div>
                <div style={{ ...field, fontFamily: 'monospace', wordBreak: 'break-all', direction: 'ltr',
                    textAlign: 'left', marginBottom: 8 }}>{HOOK(freshKey)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Copy value={HOOK(freshKey)} label={t('انسخ الرابط', 'Copy URL')} />
                    <Copy value={freshKey} label={t('انسخ المفتاح', 'Copy key')} />
                    <Copy value={sample} label={t('انسخ مثالاً للمبرمج', 'Copy a developer example')} />
                </div>
                <div style={{ fontSize: '0.74rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 10 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>
                        {provDef ? (isRTL ? provDef.pasteHintAr : provDef.pasteHintEn) : ''}
                    </strong>
                    <br />
                    {t('وبعدها: كلّما تغيّرت كمّيةُ منتجٍ عندك، يُرسل نظامُك رسالةً إلى هذا الرابط فتتحدّث تاكي وحدها. ولا تكتب شيئاً بعد اليوم.',
                       'After that: whenever a product quantity changes, your system posts to this URL and TAKI updates itself. Nothing more to type.')}
                </div>
                <button type="button" style={btn(true)} onClick={() => setFreshKey(null)}>
                    ✅ {t('نسختُه — أغلِق', 'Copied — close')}
                </button>
            </div>
        );
    }

    // ── ② لا ربط بعد ─────────────────────────────────────────────────────
    if (!integ) {
        return (
            <div style={box}>
                <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                    🔌 {t('اربط مخزونك بنظامك', 'Link your stock to your system')}
                </div>
                <div style={{ fontSize: '0.75rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 10 }}>
                    {t('بِعتَ قطعةً في المحل أو من نظامك؟ تنقص من تاكي تلقائياً. وبِعتَ عبر تاكي؟ يصل نظامَك فوراً. ',
                       'Sold a unit in-store or from your own system? It drops in TAKI automatically. Sold through TAKI? Your system hears at once. ')}
                    <strong style={{ color: 'var(--text-primary)' }}>
                        {t('ويعمل مع أيّ نظامٍ يستطيع نداءَ رابط', 'It works with any system that can call a URL')}
                    </strong>
                    {t(' — لا يلزم أن يكون في القائمة.', ' — it need not be in the list.')}
                </div>

                {/* 🔴 v15.14 — جوابُ سؤال ناصر، في الشاشة لا في رسالةٍ منّي:
                    «لم أفهم سبب طلبك للرابط وأيّ رابط تقصد». وكان في الشاشة
                    ثلاثةُ أشياء تُسمّى «رابط» فالتبست حتماً. فحُذف الميتُ منها،
                    وبقي اثنان يُسمّى كلٌّ منهما باتجاهه صراحةً قبل أن يُطلب. */}
                <div style={{ fontSize: '0.75rem', lineHeight: 2, padding: 12, borderRadius: 12,
                    background: 'var(--body-bg)', border: '1px solid var(--border-color)', marginBottom: 10 }}>
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
                        {t('ولا نقرأ مخزونك من رابط — هذا أهمُّ ما يجب أن يكون واضحاً:',
                           'And we do not read your stock from a link — the important part:')}
                    </div>
                    {t('⬅️ ', '⬅️ ')}
                    <strong style={{ color: 'var(--text-primary)' }}>{t('رابطٌ نُعطيك إيّاه', 'A URL we give you')}</strong>
                    {t(' — تلصقه في نظامك مرّةً واحدة. ونظامُك هو الذي ينادينا كلّما تغيّرت كمّية، فنعرف الرقم منه. هذا هو الربطُ كلُّه، ولا تكتب شيئاً بعده.',
                       ' — paste it into your system once. Your system then calls us whenever a quantity changes, and we learn the number from it. That is the whole link; nothing more to type.')}
                    <br />
                    {t('➡️ ', '➡️ ')}
                    <strong style={{ color: 'var(--text-primary)' }}>{t('ورابطٌ نطلبه منك', 'And a URL we ask you for')}</strong>
                    {t(' — اختياريٌّ تماماً وداخل «متقدّم»، ولا تحتاجه إلا إن أردتَ أن نُرسل نحن إلى نظامك كلّ بيعٍ وإرجاع. اتركه فارغاً ولا ينقص الربطَ شيء.',
                       ' — fully optional, under «Advanced». You need it only if you want US to post every sale and return into your system. Leave it empty and the link still works fully.')}
                </div>

                {!open ? (
                    <button type="button" style={btn(true)} onClick={() => setOpen(true)}>
                        🔌 {t('ابدأ الربط', 'Start linking')}
                    </button>
                ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                        <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {t('نوع نشاطك', 'Your segment')}
                            <select style={{ ...field, marginTop: 5 }} value={segment}
                                onChange={e => { const v = e.target.value as ProviderSegment; setSegment(v); setProvider('custom'); }}>
                                {PROVIDER_SEGMENTS.map(s => (
                                    <option key={s.id} value={s.id}>{s.icon} {isRTL ? s.nameAr : s.nameEn}</option>
                                ))}
                            </select>
                        </label>

                        {/* 🔴 إفصاحٌ لا يُخفى: قطاعٌ لا نستطيع تمثيله يُقال سببُه. */}
                        {segDef && !segDef.supported && (
                            <div style={{ fontSize: '0.74rem', lineHeight: 1.9, padding: 10, borderRadius: 10,
                                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#b45309' }}>
                                ⚠️ {segDef.blockedReason}
                            </div>
                        )}

                        <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {t('نظامك', 'Your system')}
                            <select style={{ ...field, marginTop: 5 }} value={provider} onChange={e => setProvider(e.target.value)}>
                                {providers.map(p => (
                                    <option key={p.id} value={p.id}>{isRTL ? p.nameAr : p.nameEn}</option>
                                ))}
                                {!providers.some(p => p.id === 'custom') && (
                                    <option value="custom">{t('نظامٌ آخر — ربطٌ مباشر', 'Another system — direct link')}</option>
                                )}
                            </select>
                        </label>

                        {/* 🔴 لا يُوعَد بما لا يُنفَّذ: سلّة وزد لا تسمحان للتاجر بتسجيل
                            رابطٍ بنفسه (وثيقةُ زد صريحة، وسلّة عبر بوّابة الشركاء).
                            فيُقال ما يلزم فعلاً قبل أن يضغط، لا بعد أن يضغط. */}
                        {provDef && provDef.selfServeWebhook !== 'yes' && provDef.needsAr && (
                            <div style={{ fontSize: '0.74rem', lineHeight: 1.9, padding: 10, borderRadius: 10,
                                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#b45309' }}>
                                ⚠️ <strong>{t('هذا النظام لا يقبل لصقَ رابطٍ من التاجر', 'This system does not accept a merchant-pasted URL')}</strong>
                                <br />{isRTL ? provDef.needsAr : provDef.pasteHintEn}
                                <br />{t('أنشئ الربط الآن على أيّ حال — سيعمل فور اكتمال التسجيل، ولن تُعيد شيئاً.',
                                         'Create the link now anyway — it starts working once registration completes, with nothing to redo.')}
                            </div>
                        )}
                        {provDef && (
                            <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)' }}>
                                {provDef.noteAr && isRTL ? provDef.noteAr : ''}
                                {/* 🪤 وسمُ التحقّق حقلٌ لا نثر: ما لم نفتح وثيقته الرسمية يُقال. */}
                                {provDef.stockWrite !== 'yes' && (
                                    <div style={{ marginTop: 4, fontWeight: 800, color: '#b45309' }}>
                                        {t('⚠️ قدراتُ هذا النظام لم نؤكّدها من وثيقته الرسمية بعد — يعمل الربطُ بالعقد المفتوح، ويتولّاه مطوّرك.',
                                           '⚠️ We have not confirmed this system\'s capabilities from its official docs — linking works through the open contract, handled by your developer.')}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 🔴 هذا الحقلُ هو ما أربك ناصراً — وحقُّه أن يكون متقدّماً
                            ومشروحاً: التاجرُ العاديّ لا يملك عنواناً يستقبل، وأغلبُ
                            الأنظمة تُرسل ولا تستقبل. الاتجاهُ الأساسيّ عكسُه. */}
                        <details>
                            <summary style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                ⚙️ {t('متقدّم — لمن عنده مبرمج (اختياريّ تماماً)', 'Advanced — if you have a developer (fully optional)')}
                            </summary>
                            <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)', margin: '6px 0' }}>
                                {t('هنا الاتجاهُ المعاكس: إن كان نظامك يستطيع أن **يستقبل**، ضع عنواناً نُرسل إليه كلّ بيعٍ وإرجاعٍ فوراً وموقَّعاً. ',
                                   'This is the reverse direction: if your system can RECEIVE, give a URL and we post every sale and return to it, signed. ')}
                                <strong style={{ color: 'var(--text-primary)' }}>
                                    {t('واتركه فارغاً إن لم تفهم ما هو — لا ينقص الربطَ شيئاً.',
                                       'Leave it empty if this means nothing to you — the link works fully without it.')}
                                </strong>
                            </div>
                            <input style={{ ...field, direction: 'ltr', textAlign: 'left' }}
                                placeholder="https://…" value={hook} onChange={e => setHook(e.target.value)} />
                        </details>

                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" style={btn(true)} disabled={busy} onClick={create}>
                                {busy ? t('جارٍ…', 'Working…') : t('أنشئ الربط واعرض مفتاحي', 'Create link & show my key')}
                            </button>
                            <button type="button" style={btn()} onClick={() => setOpen(false)}>
                                {t('إلغاء', 'Cancel')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── ③ ربطٌ قائم ──────────────────────────────────────────────────────
    const dealName = (id: string) => deals.find(d => d.id === id)?.item_name || id;
    return (
        <div style={box}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    🔌 {integ.label || integ.provider}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '3px 8px', borderRadius: 8,
                    background: integ.is_enabled ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                    color: integ.is_enabled ? 'var(--primary)' : 'var(--text-secondary)' }}>
                    {integ.is_enabled ? t('يعمل', 'active') : t('موقوف', 'off')}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {t('المفتاح ينتهي بـ', 'key ends in ')}…{integ.api_key_last4}
                </span>
            </div>

            <div style={{ fontSize: '0.74rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 10 }}>
                {integ.last_seen_at
                    ? t(`آخر اتصالٍ من نظامك: ${new Date(integ.last_seen_at).toLocaleString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB')}`,
                        `Last call from your system: ${new Date(integ.last_seen_at).toLocaleString('en-GB')}`)
                    : t('لم يتّصل نظامك بعد — سلّم المفتاح والعنوان لمن يديره.',
                        'Your system has not called yet — hand the key and endpoint to whoever runs it.')}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Copy value={ENDPOINT} label={t('انسخ العنوان', 'Copy endpoint')} />
                <button type="button" style={btn()} disabled={busy} onClick={async () => {
                    setBusy(true);
                    const d = await call('merchant_update_integration', { p_id: integ.id, p_enabled: !integ.is_enabled });
                    setBusy(false); if (d) await load();
                }}>{integ.is_enabled ? t('⏸ أوقِفه', '⏸ Disable') : t('▶️ شغّله', '▶️ Enable')}</button>
                <button type="button" style={btn()} disabled={busy} onClick={async () => {
                    const ok = await customConfirm(t(
                        '🔑 تدوير المفتاح\n\nسيتوقّف المفتاح الحالي فوراً، ولن يعمل نظامك حتى تضع الجديد فيه.\n\nهل تريد ذلك؟',
                        '🔑 Rotate the key\n\nThe current key stops working immediately, and your system will fail until you set the new one.\n\nProceed?'));
                    if (!ok) return;
                    setBusy(true);
                    const d = await call('merchant_rotate_integration_key', { p_id: integ.id });
                    setBusy(false); if (d) { setFreshKey(d.api_key as string); await load(); }
                }}>🔑 {t('دوّر المفتاح', 'Rotate key')}</button>
                <button type="button" style={btn(false, true)} disabled={busy} onClick={async () => {
                    const ok = await customConfirm(t(
                        `🗑 حذف الربط\n\nستُفكّ ${links.length} رابطَ منتجٍ ويتوقّف المفتاح. لا يتأثّر مخزونك الحالي في تاكي.\n\nهل تحذفه؟`,
                        `🗑 Delete the link\n\n${links.length} product link(s) will be removed and the key stops. Your current TAKI stock is unaffected.\n\nDelete?`));
                    if (!ok) return;
                    setBusy(true);
                    const d = await call('merchant_delete_integration', { p_id: integ.id });
                    setBusy(false); if (d) { setLinks([]); await load(); }
                }}>🗑 {t('احذف', 'Delete')}</button>
            </div>

            {/* ── 🔴 فقدتَ الرابط؟ ───────────────────────────────────────
                المفتاحُ جزءٌ من الرابط، وتاكي لا تحتفظ به (بصمة وlast4 فقط).
                فلا سبيلَ لعرضه ثانيةً — والمخرجُ تدويرٌ بضغطة، لا دعمٌ فنّي. */}
            <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)',
                padding: 9, borderRadius: 10, background: 'var(--body-bg)', marginBottom: 12 }}>
                📎 {integ.provider && provDefOf(integ.provider)
                    ? (isRTL ? provDefOf(integ.provider)!.pasteHintAr : provDefOf(integ.provider)!.pasteHintEn)
                    : ''}
                {provDefOf(integ.provider)?.selfServeWebhook !== 'yes' && provDefOf(integ.provider)?.needsAr && (
                    <><br /><span style={{ color: '#b45309', fontWeight: 800 }}>
                        ⚠️ {isRTL ? provDefOf(integ.provider)!.needsAr : ''}
                    </span></>
                )}
                <br />
                {t('ورابطُك يحتوي مفتاحك، وتاكي لا تحتفظ به — فإن فقدتَه اضغط «دوّر المفتاح» أعلاه وستحصل على رابطٍ جديد فوراً.',
                   'Your URL contains your key and TAKI does not store it — if you lost it, press «Rotate key» above and you get a new URL at once.')}
            </div>

            {/* ── آخرُ رسالةٍ وصلت من نظامك ──────────────────────────────
                🔴 ولماذا تُعرض: لم نُخمّن أسماءَ حقول أيّ نظام من وثيقته —
                مسحُ توثيقٍ سابق في هذا المشروع أنتج اسمَ حقلٍ مختلَقاً. فالشكلُ
                يُتعلَّم من رسالةٍ حقيقية، وهذه هي. */}
            {integ.last_payload != null && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
                        📨 {t('آخر رسالة وصلت من نظامك', 'Last message from your system')}
                        {integ.last_note === 'OK' && <span style={{ color: 'var(--primary)' }}> · {t('فُهمت وطُبّقت', 'understood & applied')}</span>}
                        {integ.last_note === 'NOT_LINKED' && <span style={{ color: '#b45309' }}> · {t('كودُها غير مربوط بعرض', 'its code is not linked to a deal')}</span>}
                        {integ.last_note === 'UNMAPPED' && <span style={{ color: '#b45309' }}> · {t('لم نفهم شكلها', 'shape not understood')}</span>}
                    </div>
                    <pre style={{ ...field, fontSize: '0.68rem', maxHeight: 120, overflow: 'auto',
                        direction: 'ltr', textAlign: 'left', margin: 0 }}>
                        {JSON.stringify(integ.last_payload, null, 1).slice(0, 900)}
                    </pre>
                    {integ.last_note === 'UNMAPPED' && (
                        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                                {t('اكتب مكانَ كود المنتج ومكانَ الكمّية داخل الرسالة أعلاه، بالنقاط. مثال: data.id و data.quantity',
                                   'Enter where the product code and the quantity sit inside the message above, dotted. Example: data.id and data.quantity')}
                            </div>
                            <input style={{ ...field, direction: 'ltr', textAlign: 'left' }} placeholder="data.id"
                                value={mapId} onChange={e => setMapId(e.target.value)} />
                            <input style={{ ...field, direction: 'ltr', textAlign: 'left' }} placeholder="data.quantity"
                                value={mapQty} onChange={e => setMapQty(e.target.value)} />
                            <button type="button" style={btn(true)} disabled={busy} onClick={async () => {
                                setBusy(true);
                                const d = await call('merchant_set_field_map', {
                                    p_id: integ.id, p_id_path: mapId.trim(), p_qty_path: mapQty.trim() });
                                setBusy(false);
                                // 🪤 لا يُقال «تمّ» إلا بدليل: القاعدة تُجرّب المسارين على
                                //    الرسالة الحقيقية وترفض خريطةً لا تعمل، فلا تسكت بصمت.
                                if (d) { await customAlert(t(`✅ فُهمت: الكود «${d.sample_id}» والكمّية ${d.sample_qty}`,
                                                             `✅ Understood: code «${d.sample_id}», quantity ${d.sample_qty}`));
                                         setMapId(''); setMapQty(''); await load(); }
                            }}>{t('🔗 اربط الحقول', '🔗 Map the fields')}</button>
                        </div>
                    )}
                </div>
            )}

            {/* ── روابطُ المنتجات ─────────────────────────────────────── */}
            <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                📦 {t('منتجاتك المربوطة', 'Linked products')} ({links.length})
            </div>
            {links.length === 0 && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.9 }}>
                    {t('لا منتجَ مربوط بعد. اربط كلّ عرضٍ بكوده في نظامك — وبدون الربط لا يعرف أيُّ الطرفين أنّ المنتج واحد.',
                       'No product linked yet. Link each deal to its code in your system — without it, neither side knows they are the same product.')}
                </div>
            )}
            {links.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '7px 0', borderTop: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-primary)' }}>{dealName(l.deal_id)}</span>
                    {l.variant_id && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>· {t('نوع', 'variant')}</span>}
                    {l.location_id && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>· {t('فرع', 'branch')}</span>}
                    <span style={{ fontSize: '0.74rem', fontFamily: 'monospace', color: 'var(--text-secondary)', direction: 'ltr' }}>
                        ⇄ {l.external_id}
                    </span>
                    <button type="button" style={{ ...btn(false, true), padding: '3px 9px', fontSize: '0.7rem', marginInlineStart: 'auto' }}
                        disabled={busy} onClick={async () => {
                            setBusy(true);
                            const d = await call('merchant_unlink_product', { p_link_id: l.id });
                            setBusy(false); if (d) await load();
                        }}>✕</button>
                </div>
            ))}

            {/* ── اربط منتجاً ─────────────────────────────────────────── */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-color)', display: 'grid', gap: 8 }}>
                <select style={field} value={dealId} onChange={e => { setDealId(e.target.value); setVariantId(''); setLocationId(''); }}>
                    <option value="">{t('— اختر العرض —', '— pick a deal —')}</option>
                    {deals.map(d => <option key={d.id} value={d.id}>{d.item_name}</option>)}
                </select>

                {/* 🪤 الصنفُ والفرعُ اختياريان: كودٌ واحد قد يشير إلى العرض كلّه،
                    أو إلى صنفٍ بعينه، أو إلى فرع. والقاعدة تفرض تفرّد الكود. */}
                {!!selectedDeal?.variants?.length && (
                    <select style={field} value={variantId} onChange={e => setVariantId(e.target.value)}>
                        <option value="">{t('كلّ الأنواع', 'all variants')}</option>
                        {selectedDeal!.variants!.map(v => (
                            <option key={v.id} value={v.id}>{v.label || v.id}</option>
                        ))}
                    </select>
                )}
                {selectedDeal?.loc_qty_mode === 'per_location' && !!selectedDeal?.locations?.length && (
                    <select style={field} value={locationId} onChange={e => setLocationId(e.target.value)}>
                        <option value="">{t('كلّ الفروع', 'all branches')}</option>
                        {selectedDeal!.locations!.map(l => (
                            <option key={l.id} value={l.id}>{l.name || l.id}</option>
                        ))}
                    </select>
                )}

                <input style={{ ...field, direction: 'ltr', textAlign: 'left' }} value={extId}
                    onChange={e => setExtId(e.target.value)}
                    placeholder={t('الكود في نظامك (SKU / باركود / معرّف المنتج)', 'Code in your system (SKU / barcode / product id)')} />
                <button type="button" style={btn(true)} disabled={busy} onClick={linkProduct}>
                    {busy ? t('جارٍ…', 'Working…') : t('🔗 اربط هذا المنتج', '🔗 Link this product')}
                </button>
            </div>
        </div>
    );
};

export default StockLinkCard;
