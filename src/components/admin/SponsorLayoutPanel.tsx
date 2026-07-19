import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { adminService } from '../../services/adminService';
import { sponsorRepository, AdminSponsorRow } from '../../repositories/sponsorRepository';
import { SponsorLabel, SponsorLayout, DEFAULT_SPONSOR_LAYOUT, parseSponsorLayout, isSponsorActive } from '../../utils/helpers';

/**
 * v12.50 — «🎛 ترتيب ظهور الرعاة والمعلنين» (طلب ناصر: تحكم يدوي كامل).
 * يكتب platform_settings.sponsor_layout الذي تقرؤه القوائم (الرئيسية + كل
 * العروض) عبر interleaveSponsored، ويقرأ ترتيبَ الطبقات bot_browse_deals
 * في البوتين أيضاً — تعديل واحد ينعكس على الويب والبوتات فوراً (realtime).
 *
 * التحكم: المسافة بين الإعلانات، هل تتصدر بطاقة مروَّجة القائمة، ترتيب
 * الطبقات الأربع، أسلوب التناوب داخل الطبقة، وترتيب المتاجر الراعية يدوياً.
 */

const TIER_META: Record<SponsorLabel, { emoji: string; ar: string; hint: string }> = {
    sponsor: { emoji: '👑', ar: 'راعٍ رسمي', hint: 'إطار ذهبي + شارة «راعٍ رسمي»' },
    ad:      { emoji: '📣', ar: 'معلن',      hint: 'إطار ذهبي + شارة «إعلان»' },
    star:    { emoji: '⭐', ar: 'نجمة',      hint: 'إطار ذهبي + نجمة بلا نص' },
    none:    { emoji: '🥇', ar: 'إطار ذهبي فقط', hint: 'تمييز صامت بلا أي شارة' },
};

const SponsorLayoutPanel: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [layout, setLayout] = useState<SponsorLayout>(DEFAULT_SPONSOR_LAYOUT);
    const [sponsors, setSponsors] = useState<AdminSponsorRow[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');

    useEffect(() => {
        if (!open || loaded) return;
        let alive = true;
        (async () => {
            const [{ data }, all] = await Promise.all([
                supabase.from('platform_settings').select('value').eq('key', 'sponsor_layout').maybeSingle(),
                sponsorRepository.listAll().catch(() => [] as AdminSponsorRow[]),
            ]);
            if (!alive) return;
            const parsed = parseSponsorLayout(data?.value);
            const active = (all || []).filter(s => isSponsorActive(s));
            // القائمة المعروضة = ترتيب المالك المحفوظ أولاً ثم البقية حسب priority.
            active.sort((a, b) => {
                const ia = parsed.storeOrder.indexOf(a.storeId);
                const ib = parsed.storeOrder.indexOf(b.storeId);
                if (ia !== -1 || ib !== -1) {
                    if (ia === -1) return 1;
                    if (ib === -1) return -1;
                    return ia - ib;
                }
                return (b.priority ?? 0) - (a.priority ?? 0);
            });
            setSponsors(active);
            setLayout(parsed);
            setLoaded(true);
        })();
        return () => { alive = false; };
    }, [open, loaded]);

    const save = async (next: SponsorLayout) => {
        setLayout(next);
        setSaveState('saving');
        const r = await adminService.setPlatformSetting('sponsor_layout', {
            every_n: next.everyN,
            lead: next.lead,
            tier_order: next.tierOrder,
            rotation: next.rotation,
            store_order: next.storeOrder,
        }, 'v12.50 — نمط ظهور الرعاة/المعلنين في قوائم العروض (ويب + بوتات)');
        setSaveState(r.success ? 'saved' : 'error');
        if (r.success) setTimeout(() => setSaveState(''), 2500);
    };

    const moveTier = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= layout.tierOrder.length) return;
        const arr = [...layout.tierOrder];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        save({ ...layout, tierOrder: arr });
    };

    const moveStore = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= sponsors.length) return;
        const arr = [...sponsors];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        setSponsors(arr);
        save({ ...layout, storeOrder: arr.map(s => s.storeId) });
    };

    // معاينة حية للنمط: بطاقة مروَّجة (حسب أول طبقة موجودة) ثم everyN عاديات.
    const preview = useMemo(() => {
        const present = layout.tierOrder.filter(t => sponsors.some(s => (s.labelType || 'ad') === t));
        const adEmoji = (i: number) => TIER_META[(present[i % Math.max(1, present.length)] || layout.tierOrder[0])].emoji;
        const cells: string[] = [];
        let adIdx = 0;
        if (layout.lead) cells.push(adEmoji(adIdx++));
        for (let block = 0; block < 3; block++) {
            for (let k = 0; k < Math.min(layout.everyN, 8); k++) cells.push('▫️');
            cells.push(adEmoji(adIdx++));
        }
        return cells;
    }, [layout, sponsors]);

    return (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl shadow-sm overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-2 p-4 text-right"
            >
                <div className="text-2xl">🎛</div>
                <div className="flex-1">
                    <div className="font-bold text-base text-amber-900">ترتيب ظهور الرعاة والمعلنين</div>
                    <div className="text-xs text-amber-700 mt-0.5">
                        تحكم يدوي كامل: المسافة، البطاقة الأولى، ترتيب الطبقات (راعٍ/معلن/نجمة/إطار)، وتناوب المتاجر — يطبَّق على الويب والبوتات
                    </div>
                </div>
                <div className="text-amber-700 font-black">{open ? '▲' : '▼'}</div>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-4">
                    {!loaded ? (
                        <div className="text-sm text-amber-700 font-bold py-4 text-center">⏳ جاري التحميل...</div>
                    ) : (
                        <>
                            {/* المعاينة الحية */}
                            <div className="bg-[var(--card-bg)] rounded-xl p-3 border border-amber-100">
                                <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">👁 معاينة النمط (كل ▫️ = منتج عادي)</div>
                                <div className="text-lg tracking-wider leading-relaxed break-words" dir="rtl">{preview.join(' ')}</div>
                            </div>

                            {/* المسافة + البطاقة الأولى */}
                            <div className="bg-[var(--card-bg)] rounded-xl p-3 border border-amber-100 space-y-3">
                                <div>
                                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                                        📏 عدد المنتجات العادية بين كل بطاقتين مروَّجتين
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {[1, 2, 3, 4, 5, 8, 10].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => save({ ...layout, everyN: n })}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-extrabold border ${layout.everyN === n
                                                    ? 'bg-amber-500 text-white border-amber-500'
                                                    : 'bg-[var(--body-bg)] text-[var(--text-primary)] border-[var(--border-color)]'}`}
                                            >{n}</button>
                                        ))}
                                        <input
                                            type="number" min={1} max={20}
                                            value={layout.everyN}
                                            onChange={(e) => {
                                                const n = Math.min(20, Math.max(1, Number(e.target.value) || 1));
                                                save({ ...layout, everyN: n });
                                            }}
                                            className="w-16 px-2 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-sm font-bold text-[var(--text-primary)] text-center"
                                        />
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={layout.lead}
                                        onChange={(e) => save({ ...layout, lead: e.target.checked })}
                                        className="w-4 h-4 accent-amber-500"
                                    />
                                    <span className="text-sm font-bold text-[var(--text-primary)]">🥇 بطاقة مروَّجة تتصدّر أول القائمة (قبل أي منتج عادي)</span>
                                </label>
                            </div>

                            {/* ترتيب الطبقات */}
                            <div className="bg-[var(--card-bg)] rounded-xl p-3 border border-amber-100">
                                <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">
                                    🏆 ترتيب الطبقات — الأعلى يظهر أولاً (تنعكس على البوتات أيضاً)
                                </div>
                                <div className="space-y-1.5">
                                    {layout.tierOrder.map((t, i) => (
                                        <div key={t} className="flex items-center gap-2 bg-[var(--body-bg)] rounded-lg px-3 py-2 border border-[var(--border-color)]">
                                            <span className="text-base">{TIER_META[t].emoji}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-extrabold text-[var(--text-primary)]">{TIER_META[t].ar}</div>
                                                <div className="text-[10px] text-[var(--text-secondary)] font-semibold">{TIER_META[t].hint}</div>
                                            </div>
                                            <button onClick={() => moveTier(i, -1)} disabled={i === 0}
                                                className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-black disabled:opacity-30">↑</button>
                                            <button onClick={() => moveTier(i, 1)} disabled={i === layout.tierOrder.length - 1}
                                                className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-black disabled:opacity-30">↓</button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* أسلوب التناوب */}
                            <div className="bg-[var(--card-bg)] rounded-xl p-3 border border-amber-100">
                                <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">🔁 عند وجود أكثر من متجر في نفس الطبقة</div>
                                <div className="space-y-1.5">
                                    <label className="flex items-start gap-2 cursor-pointer select-none">
                                        <input type="radio" name="sp-rotation" checked={layout.rotation === 'round_robin'}
                                            onChange={() => save({ ...layout, rotation: 'round_robin' })} className="mt-1 accent-amber-500" />
                                        <span className="text-sm font-bold text-[var(--text-primary)]">
                                            تناوب متجر-متجر
                                            <span className="block text-[10px] text-[var(--text-secondary)] font-semibold">متجر١ ثم متجر٢ ثم متجر٣ ثم متجر١… — لا يهيمن متجر واحد</span>
                                        </span>
                                    </label>
                                    <label className="flex items-start gap-2 cursor-pointer select-none">
                                        <input type="radio" name="sp-rotation" checked={layout.rotation === 'sequential'}
                                            onChange={() => save({ ...layout, rotation: 'sequential' })} className="mt-1 accent-amber-500" />
                                        <span className="text-sm font-bold text-[var(--text-primary)]">
                                            متجر يعرض كل منتجاته ثم الذي يليه
                                            <span className="block text-[10px] text-[var(--text-secondary)] font-semibold">كل منتجات متجر١ أولاً، ثم كل منتجات متجر٢…</span>
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* ترتيب المتاجر يدوياً */}
                            <div className="bg-[var(--card-bg)] rounded-xl p-3 border border-amber-100">
                                <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">
                                    🏪 ترتيب المتاجر الراعية يدوياً — الأعلى يبدأ أولاً داخل طبقته
                                </div>
                                {sponsors.length === 0 ? (
                                    <div className="text-xs text-[var(--text-secondary)] font-bold py-2 text-center">
                                        لا يوجد رعاة نشطون حالياً — فعّل الرعاية لمتجر من صندوق «الرعاة» بالأعلى.
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {sponsors.map((s, i) => (
                                            <div key={s.storeId} className="flex items-center gap-2 bg-[var(--body-bg)] rounded-lg px-3 py-2 border border-[var(--border-color)]">
                                                <span className="text-base">{TIER_META[(s.labelType || 'ad') as SponsorLabel].emoji}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-extrabold text-[var(--text-primary)] truncate">{s.shop || s.storeName || s.storeId}</div>
                                                    <div className="text-[10px] text-[var(--text-secondary)] font-semibold">{TIER_META[(s.labelType || 'ad') as SponsorLabel].ar}</div>
                                                </div>
                                                <button onClick={() => moveStore(i, -1)} disabled={i === 0}
                                                    className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-black disabled:opacity-30">↑</button>
                                                <button onClick={() => moveStore(i, 1)} disabled={i === sponsors.length - 1}
                                                    className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-black disabled:opacity-30">↓</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* الحالة + استعادة الافتراضي */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-bold">
                                    {saveState === 'saving' && <span className="text-amber-700">⏳ جاري الحفظ...</span>}
                                    {saveState === 'saved' && <span className="text-emerald-700">✓ محفوظ — يطبَّق فوراً على كل الأجهزة</span>}
                                    {saveState === 'error' && <span className="text-red-600">❌ تعذّر الحفظ — حاول مجدداً</span>}
                                    {saveState === '' && <span className="text-[var(--text-secondary)]">كل تغيير يُحفظ تلقائياً</span>}
                                </div>
                                <button
                                    onClick={() => save({ ...DEFAULT_SPONSOR_LAYOUT })}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-[var(--body-bg)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                                >
                                    ↺ استعادة الافتراضي
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default SponsorLayoutPanel;
