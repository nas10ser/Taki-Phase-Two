/**
 * CapacityCard — «هل اقتربنا من أيّ سقف؟» (v15.54)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «أبلِغ الأدمن في حال وصول الطاقة القصوى لأيّ برنامج — سواء عدد
 * المستخدمين أو ريسند أو السيرفر». والإنذارُ يصل إشعاراً كلَّ ربع ساعة
 * (`taki_capacity_check`)، وهذه الشاشةُ تُريه الأرقامَ قبل أن تصرخ.
 *
 * 🪤 ولا رقمَ محسوبٌ هنا: `taki_capacity_report` تقرأ المقاييسَ والحدودَ معاً
 *    في نداءٍ واحد، فما تراه الشاشةُ هو بعينه ما يقيسه الإنذار. وحسابُ النسبة
 *    في المتصفّح كان سيُنتج رقمين مختلفين لنفس اللحظة.
 * 🪤 والحدودُ إعدادٌ (`platform_settings.capacity_limits`) لا ثوابت — فلا
 *    يُكتب سقفٌ نصّاً في شاشة (أمرُ ناصر الثابت).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { AdmSection, AdmSkeleton, AdmError, AdmButton } from './ui';

type Report = {
    limits: Record<string, number>;
    db_connections: { used: number; max: number; pct: number };
    db_size_mb: number; storage_mb: number;
    email_24h: number; cron_fail_24h: number; users: number;
    at: string;
};

const Bar: React.FC<{ label: string; value: number; warn: number; crit: number; unit?: string }> =
({ label, value, warn, crit, unit = '' }) => {
    const pct = Math.max(0, Math.min(100, (value / Math.max(crit, 1)) * 100));
    const level = value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok';
    const color = level === 'crit' ? '#dc2626' : level === 'warn' ? '#b45309' : '#059669';
    const nf = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 1 });
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>{label}</span>
                <span style={{ fontSize: '.78rem', fontWeight: 900, color }}>
                    {nf(value)}{unit} <span style={{ opacity: .6, fontWeight: 700 }}>/ {nf(crit)}{unit}</span>
                </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--adm-surface-2)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .3s' }} />
            </div>
        </div>
    );
};

export const CapacityCard: React.FC = () => {
    const [r, setR] = useState<Report | null>(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        const { data, error } = await supabase.rpc('taki_capacity_report');
        if (error) { setErr(error.message); setLoading(false); return; }
        setR(data as unknown as Report);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const L = (k: string, d: number) => Number(r?.limits?.[k] ?? d);

    return (
        <AdmSection icon="📊" title="طاقةُ المنصّة" desc="كم بقي قبل كلّ سقف. والإنذارُ يصلك إشعاراً تلقائياً عند الاقتراب — ويصمت وحده حين ينزل المقياس.">
            {loading ? <AdmSkeleton /> : err ? <AdmError message={err} onRetry={load} /> : r ? (
                <>
                    <Bar label="اتصالاتُ قاعدة البيانات" value={r.db_connections.pct}
                         warn={L('db_connections_warn_pct', 70)} crit={L('db_connections_crit_pct', 85)} unit="٪" />
                    <Bar label="حجمُ قاعدة البيانات" value={r.db_size_mb}
                         warn={L('db_size_warn_mb', 4096)} crit={L('db_size_crit_mb', 8192)} unit=" م.ب" />
                    <Bar label="الصورُ والملفّات" value={r.storage_mb}
                         warn={L('storage_warn_mb', 20480)} crit={L('storage_crit_mb', 40960)} unit=" م.ب" />
                    <Bar label="بريدُ اليوم (سقفُ المزوّد)" value={r.email_24h}
                         warn={L('email_daily_warn', 80)} crit={L('email_daily_crit', 95)} />
                    <Bar label="وظائفُ الخادم الفاشلة (٢٤ ساعة)" value={r.cron_fail_24h}
                         warn={L('cron_fail_warn', 3)} crit={L('cron_fail_crit', 10)} />
                    <Bar label="عددُ المستخدمين" value={r.users}
                         warn={L('users_warn', 500000)} crit={L('users_crit', 900000)} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10 }}>
                        <span style={{ fontSize: '.7rem', color: 'var(--adm-fg-3)', fontWeight: 700 }}>
                            {r.db_connections.used} اتصالاً من {r.db_connections.max}
                        </span>
                        <AdmButton onClick={load}>🔄 تحديث</AdmButton>
                    </div>
                </>
            ) : null}
        </AdmSection>
    );
};

export default CapacityCard;
