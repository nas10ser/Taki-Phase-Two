/**
 * BotAnalytics (v12.00) — links the admin center to the Telegram + WhatsApp bots.
 *
 * Answers «هل التحليلات مرتبطة بالبوتات؟»: shows how many users linked each bot,
 * their language split, and — now that bookings/deals carry a `source` column
 * stamped by bot_book_deal / bot_add_deal — the real channel attribution of
 * bookings and deals (web vs telegram vs whatsapp).
 */
import React, { useEffect, useState } from 'react';
import { adminService, BotAnalytics as BotData, ChannelSplit } from '../../services/adminService';

const CH = {
    web: { label: 'الموقع/التطبيق', color: '#2563eb', emoji: '🌐' },
    telegram: { label: 'تيليجرام', color: '#229ED9', emoji: '✈️' },
    whatsapp: { label: 'واتساب', color: '#25D366', emoji: '🟢' },
} as const;

const sum = (s: ChannelSplit) => (s?.web || 0) + (s?.telegram || 0) + (s?.whatsapp || 0);

const SplitBar: React.FC<{ title: string; data: ChannelSplit }> = ({ title, data }) => {
    const total = sum(data) || 1;
    const keys: (keyof ChannelSplit)[] = ['web', 'telegram', 'whatsapp'];
    return (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center justify-between mb-2.5">
                <span className="text-sm font-extrabold text-[var(--text-primary)]">{title}</span>
                <span className="text-xs font-bold text-[var(--text-secondary)]">{sum(data)} {sum(data) === 0 ? 'لا يوجد' : 'إجمالاً'}</span>
            </div>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--gray-100)]">
                {keys.map((k) => {
                    const v = data?.[k] || 0;
                    if (v === 0) return null;
                    return <div key={k} style={{ width: `${(v / total) * 100}%`, background: CH[k].color }} title={`${CH[k].label}: ${v}`} />;
                })}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
                {keys.map((k) => {
                    const v = data?.[k] || 0;
                    return (
                        <div key={k} className="text-center">
                            <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]">
                                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CH[k].color }} />
                                {CH[k].emoji} {CH[k].label}
                            </div>
                            <div className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">{v}</div>
                            <div className="text-[10px] text-[var(--text-secondary)]">{Math.round((v / total) * 100)}%</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const Tile: React.FC<{ emoji: string; value: React.ReactNode; label: string; accent: string }> = ({ emoji, value, label, accent }) => (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-center" style={{ borderTop: `3px solid ${accent}` }}>
        <div className="text-2xl mb-1">{emoji}</div>
        <div className="text-2xl font-extrabold text-[var(--text-primary)] tabular-nums leading-none">{value}</div>
        <div className="text-[11px] font-bold text-[var(--text-secondary)] mt-1.5">{label}</div>
    </div>
);

export const BotAnalytics: React.FC = () => {
    const [data, setData] = useState<BotData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            const d = await adminService.getBotAnalytics();
            if (alive) { setData(d); setLoading(false); }
        })();
        return () => { alive = false; };
    }, []);

    const linkedTotal = data ? data.tg_linked + data.wa_linked - data.both_linked : 0;
    const linkPct = data && data.total_users > 0 ? Math.round((linkedTotal / data.total_users) * 100) : 0;

    return (
        <div className="space-y-4" dir="rtl">
            <div>
                <h2 className="text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    🤖 تحليلات البوتات
                    <span className="text-xs font-bold text-[var(--text-secondary)]">تيليجرام + واتساب</span>
                </h2>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                    اعتماد المستخدمين على البوتات، ونسبة الحجوزات والعروض القادمة من كل قناة.
                </p>
            </div>

            {loading ? (
                <div className="py-10 text-center text-[var(--text-secondary)] text-sm">⏳ جارٍ التحميل…</div>
            ) : !data ? (
                <div className="py-8 text-center text-[var(--text-secondary)] text-sm rounded-2xl border border-dashed border-[var(--border-color)]">
                    تعذّر تحميل تحليلات البوتات.
                </div>
            ) : (
                <>
                    {/* Adoption tiles */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Tile emoji="✈️" value={data.tg_linked} label="مرتبط بتيليجرام" accent={CH.telegram.color} />
                        <Tile emoji="🟢" value={data.wa_linked} label="مرتبط بواتساب" accent={CH.whatsapp.color} />
                        <Tile emoji="🔗" value={`${linkPct}%`} label={`ربطوا بوتاً (${linkedTotal}/${data.total_users})`} accent="#7c3aed" />
                        <Tile emoji="🌐" value={<span>{data.lang_ar}<span className="text-[var(--text-secondary)] text-sm"> ع</span> · {data.lang_en}<span className="text-[var(--text-secondary)] text-sm"> EN</span></span>} label="لغة مستخدمي البوت" accent="#f59e0b" />
                    </div>

                    {/* Channel attribution */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <SplitBar title="🎟️ الحجوزات حسب القناة (الكل)" data={data.bookings_total} />
                        <SplitBar title="🎟️ الحجوزات (آخر ٣٠ يوم)" data={data.bookings_30d} />
                        <SplitBar title="🏷️ العروض المُضافة حسب القناة" data={data.deals_total} />
                    </div>

                    {sum(data.bookings_total) > 0 && data.bookings_total.web === sum(data.bookings_total) && (
                        <p className="text-[11px] text-[var(--text-secondary)] bg-[var(--gray-100)] rounded-xl px-3 py-2 leading-relaxed">
                            ℹ️ الحجوزات والعروض السابقة محسوبة على «الموقع/التطبيق». الحجوزات والعروض التي تتم من البوتات
                            من الآن فصاعداً ستُحسب تلقائياً على تيليجرام/واتساب وتظهر هنا.
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default BotAnalytics;
