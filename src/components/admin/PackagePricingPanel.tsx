import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { packageRepository } from '../../repositories/packageRepository';
import { LocationPackage, effectivePrice } from '../../data/packages';

/**
 * Admin panel to edit EVERY subscription package's monthly pricing (v11.36):
 * price, discount, allowed locations, duration, label, active — fully flexible.
 * Gold-themed, light/dark safe (gradient border + var(--card-bg) interior).
 * Saves the whole catalogue to platform_settings.location_packages.
 */

// Gold ring that adapts to both themes: the interior is the theme card colour,
// only the 2px border is the gold gradient.
const goldRing: React.CSSProperties = {
    border: '2px solid transparent',
    borderRadius: 18,
    backgroundImage:
        'linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)',
    backgroundOrigin: 'border-box',
    backgroundClip: 'padding-box, border-box',
    boxShadow: '0 6px 22px rgba(245,158,11,0.18)',
};

const numInputCls =
    'w-full px-2.5 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm font-bold text-[var(--text-primary)] outline-none focus:border-amber-500';

const PackagePricingPanel: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
    const { customAlert, customConfirm } = useApp();
    const [pkgs, setPkgs] = useState<LocationPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);
    const [dirty, setDirty] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const list = await packageRepository.get();
        setPkgs(list);
        setLoading(false);
        setDirty(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const update = (i: number, patch: Partial<LocationPackage>) => {
        setPkgs((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
        setDirty(true);
    };

    const addPackage = () => {
        setPkgs((prev) => {
            const nextId = prev.reduce((m, p) => Math.max(m, p.id), 0) + 1;
            const lastMax = prev.length ? prev[prev.length - 1].max : 1;
            const lastPrice = prev.length ? prev[prev.length - 1].price : 200;
            return [...prev, {
                id: nextId, max: lastMax + 5, price: lastPrice + 50, discount: 0, durationDays: 30,
                ar: `الباقة ${prev.length + 1}`, en: `Package ${prev.length + 1}`,
                descAr: `حتى ${lastMax + 5} مواقع`, descEn: `up to ${lastMax + 5} locations`, active: true,
            }];
        });
        setDirty(true);
    };

    const removePackage = async (i: number) => {
        const ok = await customConfirm('حذف هذه الباقة؟');
        if (!ok) return;
        setPkgs((prev) => prev.filter((_, idx) => idx !== i));
        setDirty(true);
    };

    const save = async () => {
        if (saving) return;
        setSaving(true);
        let res: { success: boolean; error?: string } = { success: false };
        try {
            // Keep descAr in sync with max so merchant cards read naturally.
            const normalized = pkgs.map((p) => ({
                ...p,
                descAr: p.descAr?.trim() || (p.max === 1 ? 'موقع واحد فقط' : `حتى ${p.max} مواقع`),
                descEn: p.descEn?.trim() || (p.max === 1 ? '1 location only' : `up to ${p.max} locations`),
            }));
            res = await packageRepository.save(normalized);
        } catch (e: any) {
            res = { success: false, error: e?.message || 'تعذّر الحفظ' };
        } finally {
            setSaving(false);
        }
        if (!res.success) { await customAlert('❌ ' + (res.error || 'تعذّر حفظ الباقات')); return; }
        setDirty(false);
        await customAlert('✅ تم حفظ الباقات. ستظهر للتجار بأسعارها الجديدة فوراً.');
        onSaved?.();
        load();
    };

    return (
        <section style={goldRing} className="overflow-hidden">
            <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3.5">
                <span className="font-extrabold text-base flex items-center gap-2" style={{ color: '#b45309' }}>
                    💎 باقات المواقع والأسعار
                    <span className="text-[11px] text-white rounded-full px-2 py-0.5" style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}>
                        {pkgs.length} باقات • شهري
                    </span>
                </span>
                <span style={{ color: '#b45309' }} className="text-sm">{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3">
                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                        عدّل سعر/خصم/عدد المواقع/مدة كل باقة بحرية. كل الباقات شهرية. ما تحفظه هنا يظهر للتجار فوراً عند تفعيل الاشتراك.
                    </div>

                    {loading ? (
                        <div className="space-y-2">
                            {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-[var(--gray-100)] rounded-xl animate-pulse" />)}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {pkgs.map((p, i) => {
                                const eff = effectivePrice(p);
                                return (
                                    <div key={p.id} className="bg-[var(--card-bg)] rounded-xl border border-amber-200 p-3">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-lg">💰</span>
                                            <input
                                                value={p.ar}
                                                onChange={(e) => update(i, { ar: e.target.value })}
                                                className="flex-1 px-2.5 py-1.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm font-extrabold text-[var(--text-primary)] outline-none focus:border-amber-500"
                                                placeholder="اسم الباقة"
                                            />
                                            <button
                                                onClick={() => update(i, { active: !p.active })}
                                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}
                                            >
                                                {p.active ? '✓ ظاهرة' : 'مخفية'}
                                            </button>
                                            <button
                                                onClick={() => removePackage(i)}
                                                className="w-8 h-8 rounded-lg bg-red-50 text-red-600 text-sm flex items-center justify-center active:scale-90"
                                                aria-label="حذف"
                                            >🗑</button>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">عدد المواقع</span>
                                                <input type="number" min={1} value={p.max}
                                                    onChange={(e) => update(i, { max: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                                                    className={numInputCls} />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">السعر (ر.س/شهر)</span>
                                                <input type="number" min={0} value={p.price}
                                                    onChange={(e) => update(i, { price: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                                                    className={numInputCls} />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">خصم %</span>
                                                <input type="number" min={0} max={100} value={p.discount}
                                                    onChange={(e) => update(i, { discount: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                                                    className={numInputCls} />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] block mb-1">المدة (يوم)</span>
                                                <input type="number" min={1} value={p.durationDays}
                                                    onChange={(e) => update(i, { durationDays: Math.max(1, Math.round(Number(e.target.value) || 30)) })}
                                                    className={numInputCls} />
                                            </label>
                                        </div>
                                        <div className="mt-2 text-[11px] font-bold" style={{ color: '#b45309' }}>
                                            السعر الفعلي: {eff.toLocaleString('ar-SA')} ر.س / شهر
                                            {p.discount > 0 && (
                                                <span className="text-[var(--text-secondary)] line-through font-normal mr-2">{p.price.toLocaleString('ar-SA')}</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={addPackage}
                            className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-amber-300 text-amber-700 bg-amber-50 active:scale-95"
                        >
                            ➕ إضافة باقة
                        </button>
                        <button
                            onClick={save}
                            disabled={saving || !dirty}
                            className="flex-[2] py-2.5 rounded-xl text-sm font-extrabold text-white disabled:opacity-40 active:scale-95"
                            style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}
                        >
                            {saving ? 'جاري الحفظ...' : (dirty ? '💾 حفظ الباقات' : '✓ محفوظة')}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};

export default PackagePricingPanel;
