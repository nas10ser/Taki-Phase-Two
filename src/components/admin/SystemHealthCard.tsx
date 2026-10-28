/**
 * SystemHealthCard — إشارةٌ خضراءُ مرئيّة، لا غيابُ بريد (v15.28)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر: «كانت تأتيني رسالةُ فحصٍ كلَّ ٤ ساعات والآن لا تأتيني».
 *    والجوابُ أنّ الرسائل كانت **رسائلَ فشل** من GitHub، وتوقّفت لأن الفحص
 *    توقّف عن الفشل (v15.24 أصلحت إنذاراً كاذباً كان يُسقطه منذ ٢٣ أكتوبر).
 *
 * 🪤 لكنّ **«لا بريد» لا يُفرّق بين «سليم» و«مات»** — وهذا عيبُ مراقبةٍ حقيقيّ
 *    لا سوءُ فهم: لم تكن في المنصّة كلِّها **أيُّ شاشةٍ تعرض صحّة النظام**،
 *    فلا يعلم ناصرٌ عنه شيئاً إلا حين يفشل. والمراقبةُ التي لا تقول «أنا
 *    أعمل» تترك صاحبَها يخمّن.
 *    ⇒ فهذه البطاقةُ هي الإشارةُ الإيجابيّة: حالةٌ حيّةٌ تُقرأ بنظرة.
 *
 * 🪤 ولا تُنشأ دالّةٌ جديدة: `admin_system_health()` موجودةٌ منذ v14.53
 *    ومحروسةٌ بـ`is_admin()` — كانت تُحسب ولا يقرؤها أحد.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { AdmCard, AdmStat, AdmStatGrid, AdmPill, AdmButton } from './ui';

interface Health {
    status: 'ok' | 'warn' | 'crit' | string;
    issues: string[] | null;
    seen_at: string | null;
    age_seconds: number;
    db_size: string | null;
    metrics: Record<string, any> | null;
    cron: Record<string, any> | null;
}

/** «منذ كم» بالعربية بلا مكتبة — ورقمُ الدقائق يُصاغ لا يُلصق. */
const since = (sec: number, isRTL: boolean): string => {
    if (!Number.isFinite(sec) || sec < 0) return isRTL ? '—' : '—';
    if (sec < 90) return isRTL ? `قبل ${Math.max(1, Math.round(sec))} ثانية` : `${Math.round(sec)}s ago`;
    const m = Math.round(sec / 60);
    if (m < 90) return isRTL ? `قبل ${m} دقيقة` : `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return isRTL ? `قبل ${h} ساعة` : `${h} h ago`;
    return isRTL ? `قبل ${Math.round(h / 24)} يوماً` : `${Math.round(h / 24)} d ago`;
};

export const SystemHealthCard: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [h, setH] = useState<Health | null | undefined>(undefined);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc('admin_system_health');
        if (error) { setErr(error.message); setH(null); return; }
        setErr(''); setH(data as Health);
    }, []);

    useEffect(() => {
        load();
        // 🪤 النبضُ يُكتب كلَّ عشر دقائق، فالتحديثُ كلَّ دقيقةٍ يكفي ويزيد.
        const id = setInterval(load, 60_000);
        return () => clearInterval(id);
    }, [load]);

    if (h === undefined) return null;

    // 🔴 النبضُ القديم **أخطرُ من حالةٍ سيّئة**: يعني أن الخادم لا يكتب أصلاً
    //    (سقط · أو سقط الكرون · أو امتلأ القرص). فيُقدَّم على حالته المسجّلة.
    const stale = !h || h.age_seconds > 2700;
    const tone: 'ok' | 'warn' | 'bad' =
        !h || stale ? 'bad' : h.status === 'ok' ? 'ok' : h.status === 'warn' ? 'warn' : 'bad';
    const color = tone === 'ok' ? 'var(--adm-ok-fg)' : tone === 'warn' ? '#b45309' : 'var(--adm-bad-fg, #ef4444)';
    const cron = h?.cron || {};
    const met = h?.metrics || {};
    const issues: string[] = Array.isArray(h?.issues) ? h!.issues as string[] : [];

    return (
        <AdmCard>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: '1.6rem', lineHeight: 1 }} aria-hidden>
                    {tone === 'ok' ? '🟢' : tone === 'warn' ? '🟠' : '🔴'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.95rem', fontWeight: 900, color }}>
                        {err ? t('تعذّر قراءة حالة النظام', 'Could not read system health')
                            : stale ? t('الخادم لا يُبلّغ عن نفسه', 'The server is not reporting')
                                : tone === 'ok' ? t('كل شيء سليم', 'Everything is healthy')
                                    : tone === 'warn' ? t('يحتاج انتباهاً', 'Needs attention')
                                        : t('عطلٌ يحتاج تدخّلاً', 'A fault needs action')}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--adm-fg-2)', fontWeight: 700, marginTop: 2 }}>
                        {err || (h?.seen_at
                            ? t(`آخر فحصٍ للخادم ${since(h.age_seconds, true)}`,
                                 `last server check ${since(h.age_seconds, false)}`)
                            : t('لا نبضَ بعد', 'no heartbeat yet'))}
                    </div>
                </div>
                <AdmButton onClick={load}>{t('↻ حدّث', '↻ Refresh')}</AdmButton>
            </div>

            {/* 🪤 والمشاكلُ تُعرض كما كتبتها القاعدة: صياغتُها هناك عربيّةٌ
                مفهومة، وإعادةُ ترجمتها هنا مصدرُ انحرافٍ ثانٍ. */}
            {issues.length > 0 && (
                <div style={{ padding: 10, borderRadius: 'var(--adm-r-sm)', marginBottom: 10,
                    border: `1px solid ${color}`, background: 'var(--adm-surface-2)' }}>
                    {issues.map((x, i) => (
                        <div key={i} style={{ fontSize: '.78rem', fontWeight: 800, color, lineHeight: 1.9 }}>• {x}</div>
                    ))}
                </div>
            )}

            <AdmStatGrid>
                <AdmStat label={t('المهام المجدولة', 'Scheduled jobs')} scope={t('الآن', 'now')}
                    value={String(cron.jobs ?? '—')}
                    tone={(cron.failed_24h || cron.stalled || cron.never_ran_overdue) ? 'bad' : 'ok'} />
                <AdmStat label={t('فشلت خلال ٢٤ ساعة', 'failed in 24h')} scope={t('٢٤ ساعة', '24h')}
                    value={String(cron.failed_24h ?? '—')} tone={cron.failed_24h ? 'bad' : 'ok'} />
                <AdmStat label={t('متوقّفة', 'stalled')} scope={t('الآن', 'now')}
                    value={String(cron.stalled ?? '—')} tone={cron.stalled ? 'bad' : 'ok'} />
                <AdmStat label={t('القرص', 'Disk')} scope={t('الخادم', 'server')}
                    value={met.disk_pct != null ? `${met.disk_pct}%` : '—'}
                    tone={met.disk_pct >= 90 ? 'bad' : met.disk_pct >= 75 ? 'warn' : 'ok'} />
                <AdmStat label={t('الذاكرة', 'Memory')} scope={t('الخادم', 'server')}
                    value={met.mem_pct != null ? `${met.mem_pct}%` : '—'}
                    tone={met.mem_pct >= 92 ? 'bad' : met.mem_pct >= 85 ? 'warn' : 'ok'} />
                <AdmStat label={t('حجم القاعدة', 'Database size')} scope={t('الآن', 'now')}
                    value={h?.db_size || '—'} />
            </AdmStatGrid>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
                <AdmPill tone={met.bot_ok ? 'ok' : 'bad'}>
                    {t('البوت', 'Bot')} {met.bot_ok ? '✓' : '✕'}
                </AdmPill>
                <AdmPill tone={met.site_code === 200 ? 'ok' : 'bad'}>
                    {t('الموقع', 'Site')} {met.site_code ?? '—'}
                </AdmPill>
                {cron.alive_since && (
                    <AdmPill tone="ok">
                        {t('الخادم يعمل بلا انقطاع منذ ', 'up since ')}
                        {new Date(cron.alive_since).toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB')}
                    </AdmPill>
                )}
            </div>

            {/* 🔴 ولماذا هذه الجملة موجودة: ناصرٌ سأل «لماذا توقّف البريد؟».
                والجوابُ أنّ البريد **بريدُ فشلٍ** لا بريدُ فحص. وبلا قولها
                يبقى الصمتُ ملتبساً كلَّ مرّة. */}
            <div style={{ fontSize: '.72rem', lineHeight: 1.9, color: 'var(--adm-fg-3)', marginTop: 10 }}>
                ℹ️ {t('بريدُ جيتهب يصل عند **الفشل فقط** — فلا رسالةَ تعني أنّ كل شيء سليم. وهذه البطاقةُ هي الإشارةُ الإيجابيّة: تُحدَّث كل دقيقة، ويكتب الخادمُ نبضَه كل عشر دقائق.',
                      'GitHub emails you on failure only — no email means all is well. This card is the positive signal: it refreshes every minute, and the server writes its heartbeat every ten.')}
            </div>
        </AdmCard>
    );
};

export default SystemHealthCard;
