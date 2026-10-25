/**
 * StockConnectPanel — «اربط متجرك» وحالتُه الصادقة (v15.17 → v15.21)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ثلاثُ حقائقَ قِيست من وثيقتَي سلّة وزد، وهذه الشاشةُ مبنيّةٌ عليها:
 *   ١) **لا واحدةَ منهما ترسل حدثاً لتغيّر المخزون.** فالرسالةُ إشارةٌ، والرقمُ
 *      يُقرأ من واجهتهم بعدها. ⇒ فالوعدُ للتاجر «قريبٌ من الفوريّ» لا «فوريّ»،
 *      ومعه مسحٌ دوريٌّ مضمون. 🪤 ورقمُ الدقائق **لا يُكتب نصّاً هنا**:
 *      يُقرأ من `taki_stock_sync_info()` التي تقرأ جدولةَ الكرون نفسها — فأوّلُ
 *      ضبطٍ لا يجعل الجملةَ كذباً (درسُ مهلة الحجز).
 *   ٢) **ولا واحدةَ منهما تسمح للتاجر بلصق رابطٍ بنفسه** — يلزم تطبيقٌ مسجَّل
 *      وإذنٌ بضغطة. ⇒ فزرُّ «الصق الرابط» لا يُعرض لهما، بل زرُّ ربط.
 *   ٣) **ودائرةُ زد القاطعة ترفض إعادةَ استخدام رابطٍ عُطّل** («You cannot
 *      recover a webhook by re-using the same target_url»). ⇒ زرُّ «أصدر
 *      رابطاً جديداً» ليس زينةً — هو الطريقُ الوحيد للاستعادة.
 *
 * 🪤 وتطبيقُ تاكي **غيرُ مسجَّلٍ عند أيٍّ منهما اليوم** (قِيس: صفرُ مفاتيح).
 *    فالشاشةُ تقول ذلك صريحاً ولا تعرض زرّاً لا يعمل — ولا تَعِد بما لا يُنفَّذ.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { logger } from '../../utils/logger';
import { describeNote, describeQueueReason, NOTE_COLOR } from '../../data/stockNotes';
import { PROVIDER_SYSTEMS } from '../../data/stockProviders';

export interface ConnectIntegration {
    id: string;
    provider: string;
    last_note: string | null;
    last_sync_at: string | null;
    webhook_slug: string | null;
    webhook_rev: number | null;
    oauth_state: string | null;
    oauth_expires_at: string | null;
}

interface QueueRow { id: number; status: string; last_error: string | null; created_at: string }

const HOOK_BASE = 'https://api.takisa.net/functions/v1/stock-webhook/h/';

const card: React.CSSProperties = {
    marginTop: 10, padding: 11, borderRadius: 12,
    border: '1px solid var(--border-color)', background: 'var(--body-bg)',
};
const btn = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 10, fontSize: '0.76rem', fontWeight: 800,
    border: primary || danger ? 'none' : '1px solid var(--border-color)',
    background: danger ? 'var(--danger, #ef4444)' : primary ? 'var(--primary)' : 'transparent',
    color: primary || danger ? '#fff' : 'var(--text-primary)', cursor: 'pointer',
});
const mono: React.CSSProperties = {
    padding: 8, borderRadius: 8, border: '1px solid var(--border-color)',
    background: 'var(--card-bg)', color: 'var(--text-primary)',
    fontFamily: 'monospace', fontSize: '0.68rem', wordBreak: 'break-all',
    direction: 'ltr', textAlign: 'left',
};

export const StockConnectPanel: React.FC<{
    integ: ConnectIntegration;
    onChanged: () => Promise<void> | void;
}> = ({ integ, onChanged }) => {
    const { language, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [busy, setBusy] = useState(false);
    const [mins, setMins] = useState<number | null>(null);
    const [parked, setParked] = useState(0);
    const [remoteId, setRemoteId] = useState('');
    const [queue, setQueue] = useState<QueueRow[]>([]);
    const [appMissing, setAppMissing] = useState(false);

    const prov = PROVIDER_SYSTEMS.find(p => p.id === integ.provider);
    // مزوّدٌ يُربط بإذنٍ لا بلصقِ رابط — مقيسٌ من وثيقته لا مفترَض.
    const oauthProvider = integ.provider === 'salla' || integ.provider === 'zid';

    const rpc = useCallback(async (fn: string, args: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { logger.warn(`${fn}:`, error.message); return null; }
        return data as any;
    }, []);

    const refresh = useCallback(async () => {
        const [info, pk, q] = await Promise.all([
            supabase.rpc('taki_stock_sync_info'),
            oauthProvider && integ.provider === 'salla'
                ? supabase.rpc('merchant_stock_parked_count', { p_id: integ.id })
                : Promise.resolve({ data: 0, error: null } as any),
            supabase.from('stock_refresh_queue')
                .select('id,status,last_error,created_at')
                .eq('integration_id', integ.id)
                .order('id', { ascending: false }).limit(5),
        ]);
        const m = (info.data as any)?.periodic_minutes;
        setMins(typeof m === 'number' ? m : null);
        setParked(typeof pk.data === 'number' ? pk.data : 0);
        setQueue((q.data || []) as QueueRow[]);
    }, [integ.id, integ.provider, oauthProvider]);

    useEffect(() => { refresh(); }, [refresh]);

    const connect = async () => {
        setBusy(true);
        const d = await rpc('merchant_stock_connect_url', { p_id: integ.id });
        setBusy(false);
        if (!d) return;
        if (d.ok !== true) {
            if (d.error === 'APP_NOT_REGISTERED' || d.error === 'APP_INCOMPLETE') {
                setAppMissing(true);
                // 🔴 يُقال كما هو: لا تطبيقَ مسجَّلاً بعد. ووعدُ زرٍّ لا يعمل أسوأ.
                await customAlert(t(
                    'تاكي لم تُسجّل تطبيقها عند هذه المنصّة بعد، فلا يمكن الربطُ الآن.\n\nلا شيء عليك فعله — وسنُبلغك حين يُفتح. وإلى ذلك يبقى مخزونُك في تاكي كما تُعلنه بنفسك.',
                    'TAKI has not registered its app with this platform yet, so connecting is not possible.\n\nNothing for you to do — we will tell you when it opens. Until then your TAKI stock stays as you declare it.'));
                return;
            }
            await customAlert(String(d.error || 'error'));
            return;
        }
        // زد تُعيد المستخدم إلينا ⇒ نفسُ النافذة. وسلّة لا تُعيده ⇒ نافذةٌ جديدة
        // فلا يفقد التاجر شاشتَه (ولا زرَّ رجوعٍ داخل تطبيقٍ مثبَّت).
        if (d.mode === 'redirect') window.location.href = String(d.url);
        else window.open(String(d.url), '_blank', 'noopener,noreferrer');
    };

    const note = describeNote(integ.last_note, isRTL);
    const connected = !!integ.oauth_expires_at && integ.oauth_state === 'idle';
    const needsReconnect = integ.oauth_state === 'needs_reconnect';

    return (
        <div style={card}>
            {/* ── حالةُ الربط ─────────────────────────────────────────── */}
            <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                {oauthProvider
                    ? (connected ? t('✅ متجرُك مربوط', '✅ Your store is connected')
                        : needsReconnect ? t('⚠️ انقطع الإذن', '⚠️ Permission lost')
                            : t('🔗 اربط متجرك', '🔗 Connect your store'))
                    : t('🔗 رابطُك', '🔗 Your URL')}
            </div>

            {/* ما يعني وسمُ الحالة بالضبط — ولكلِّ وسمٍ نصٌّ، بلا استثناء */}
            <div style={{ fontSize: '0.74rem', lineHeight: 1.9, color: NOTE_COLOR[note.tone], fontWeight: 700 }}>
                {note.text}
            </div>
            {note.todo && (
                <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)' }}>
                    ← {note.todo}
                </div>
            )}

            {/* ── سرعةُ المزامنة: تُقرأ من الجدولة، ولا تُكتب نصّاً ──────── */}
            {oauthProvider && mins !== null && (
                <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginTop: 6 }}>
                    ⏱ {isRTL
                        ? `المزامنةُ قريبةٌ من الفوريّة لا فوريّة: أيُّ حركةٍ عندك تُقرأ خلال ثوانٍ، ومسحٌ كاملٌ كلَّ ${mins} دقيقة على أيّ حال — لأن سلّة وزد لا ترسلان حدثاً لتغيّر المخزون نفسه.`
                        : `Sync is near-instant, not instant: any movement is read within seconds, and a full sweep runs every ${mins} minutes regardless — because Salla and Zid send no event for a stock change itself.`}
                    {integ.last_sync_at && (<><br />
                        {t('آخرُ قراءةٍ ناجحة: ', 'Last successful read: ')}
                        {new Date(integ.last_sync_at).toLocaleString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB')}
                    </>)}
                </div>
            )}

            {/* ── الأزرار ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {oauthProvider && !connected && !appMissing && (
                    <button type="button" style={btn(true)} disabled={busy} onClick={connect}>
                        {needsReconnect ? t('🔄 أعِد الربط', '🔄 Reconnect') : t('🔗 اربط متجرك', '🔗 Connect your store')}
                    </button>
                )}
                {oauthProvider && connected && (
                    <>
                        <button type="button" style={btn()} disabled={busy} onClick={connect}>
                            🔄 {t('أعِد الربط', 'Reconnect')}
                        </button>
                        <button type="button" style={btn(false, true)} disabled={busy} onClick={async () => {
                            const ok = await customConfirm(t(
                                'سيتوقّف تحديثُ مخزونك من نظامك. وروابطُ منتجاتك تبقى محفوظة، ومخزونُك الحالي في تاكي لا يتأثّر.\n\nهل تفصل الربط؟',
                                'Stock updates from your system will stop. Your product links are kept and your current TAKI stock is unaffected.\n\nDisconnect?'));
                            if (!ok) return;
                            setBusy(true);
                            const d = await rpc('merchant_stock_disconnect', { p_id: integ.id });
                            setBusy(false);
                            if (d?.ok) { await onChanged(); await refresh(); }
                        }}>✂️ {t('افصل الربط', 'Disconnect')}</button>
                    </>
                )}
            </div>

            {/* ── سلّة: إذنٌ وصل ولم نستطع نسبتَه ───────────────────────── */}
            {integ.provider === 'salla' && parked > 0 && (
                <div style={{ ...card, borderColor: '#b45309', marginTop: 10 }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 900, color: '#b45309', marginBottom: 5 }}>
                        ⚠️ {t('وصل إذنٌ من سلّة ولم نتمكّن من نسبته بيقين',
                              'A Salla permission arrived and we could not attribute it with certainty')}
                    </div>
                    <div style={{ fontSize: '0.73rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        {/* 🔴 ولا نُخمّن: تخمينُ متجرٍ هنا = تسليمُ إذنِ تاجرٍ لتاجرٍ آخر. */}
                        {t('سلّة لا تُعيد لنا معرّفاً يربطه بك، فلا نُخمّن. اكتب رقمَ متجرك في سلّة (تجده في لوحة سلّة) لاستلام إذنك أنت.',
                           'Salla does not return an identifier tying it to you, and we do not guess. Enter your Salla store id (shown in your Salla dashboard) to claim your own permission.')}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input style={{ ...mono, flex: '1 1 160px' }} placeholder="1234509876"
                            value={remoteId} onChange={e => setRemoteId(e.target.value.replace(/\D/g, ''))} />
                        <button type="button" style={btn(true)} disabled={busy || !remoteId} onClick={async () => {
                            setBusy(true);
                            const d = await rpc('merchant_stock_claim_parked', { p_id: integ.id, p_remote_id: remoteId });
                            setBusy(false);
                            if (d?.ok) { setRemoteId(''); await onChanged(); await refresh(); }
                            else await customAlert(d?.error === 'NOT_FOUND'
                                ? t('لا إذنَ محفوظٌ بهذا الرقم.', 'No stored permission for that id.')
                                : String(d?.error || 'error'));
                        }}>{t('استلم إذني', 'Claim it')}</button>
                    </div>
                </div>
            )}

            {/* ── الرابط: يُعرض دائماً، ويُعاد إصدارُه بضغطة ─────────────── */}
            {integ.webhook_slug && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                        📎 {t('عنوانُ متجرك', 'Your store URL')}
                        {integ.webhook_rev ? ` · ${t('الجيل', 'generation')} ${integ.webhook_rev}` : ''}
                    </div>
                    <div style={mono}>{HOOK_BASE + integ.webhook_slug}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        <button type="button" style={btn()} onClick={() => {
                            navigator.clipboard?.writeText(HOOK_BASE + integ.webhook_slug).catch(() => {});
                        }}>📋 {t('انسخ', 'Copy')}</button>
                        <button type="button" style={btn()} disabled={busy} onClick={async () => {
                            const ok = await customConfirm(t(
                                '🆕 إصدارُ عنوانٍ جديد\n\nالعنوانُ الحالي يتوقّف فوراً. استعمِل هذا حين يقول نظامُك إنّ العنوان «معطَّل» — فبعضُ المنصّات (زد) ترفض إعادةَ تشغيل عنوانٍ عُطّل وتطلب غيرَه.\n\nومفتاحُك لا يتغيّر، فلا ينكسر شيءٌ آخر.\n\nهل تُصدره؟',
                                '🆕 Issue a new URL\n\nThe current URL stops immediately. Use this when your platform reports the endpoint as «broken» — some platforms (Zid) refuse to re-enable a broken URL and require a different one.\n\nYour key is unchanged, so nothing else breaks.\n\nIssue it?'));
                            if (!ok) return;
                            setBusy(true);
                            const d = await rpc('merchant_reissue_webhook_path', { p_id: integ.id });
                            setBusy(false);
                            if (d?.ok) { await onChanged(); await refresh(); }
                        }}>🆕 {t('أصدر عنواناً جديداً', 'Issue a new URL')}</button>
                    </div>
                    {oauthProvider && (
                        <div style={{ fontSize: '0.72rem', lineHeight: 1.9, color: 'var(--text-secondary)', marginTop: 5 }}>
                            {t('لا تحتاج لصقَ هذا العنوان بنفسك: تاكي تُسجّله عندهم بعد إذنك. وهو معروضٌ لتعرفه فقط.',
                               'You do not need to paste this yourself: TAKI registers it with them after you approve. It is shown for your reference only.')}
                        </div>
                    )}
                </div>
            )}

            {/* ── آخرُ محاولاتِ القراءة — جوابُ «لماذا لم يتحرّك رقمي» ───── */}
            {queue.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                        🔄 {t('آخرُ محاولاتِ قراءة مخزونك', 'Latest attempts to read your stock')}
                    </div>
                    {queue.map(q => {
                        const d = describeQueueReason(q.last_error, isRTL);
                        const okRow = q.status === 'done' && !q.last_error;
                        return (
                            <div key={q.id} style={{ fontSize: '0.72rem', lineHeight: 1.85,
                                color: okRow ? 'var(--primary)' : d ? NOTE_COLOR[d.tone] : 'var(--text-secondary)' }}>
                                {new Date(q.created_at).toLocaleString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB')}
                                {' — '}
                                {okRow ? t('قُرئ الرقمُ وطُبّق', 'number read and applied')
                                    : d ? d.text
                                        : q.status === 'pending' ? t('في الطابور', 'queued')
                                            : q.status === 'awaiting' ? t('أُرسل وننتظر الردّ', 'sent, awaiting reply')
                                                : q.status}
                                {d?.todo ? ` — ${d.todo}` : ''}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── وما يلزم تاكي، كما هو ──────────────────────────────── */}
            {prov?.needsAr && !connected && (
                <div style={{ fontSize: '0.72rem', lineHeight: 1.9, color: '#b45309', marginTop: 8, fontWeight: 700 }}>
                    ⚠️ {isRTL ? prov.needsAr : (prov.pasteHintEn || '')}
                </div>
            )}
        </div>
    );
};

export default StockConnectPanel;
