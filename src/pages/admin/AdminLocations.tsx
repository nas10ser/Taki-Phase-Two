/**
 * AdminLocations (v12.01) — «إدارة المولات والأسواق».
 *
 * The single source of truth for malls/markets is the DB `locations` table:
 * the bots read it live, and the website reads it through AppContext (which
 * mutates the bundled LOCATIONS array + bumps geoVersion). So every add / edit /
 * delete here reflects instantly in the bots and on the next render of the app.
 *
 * The admin searches, adds (name + type + city + map pin), edits, and deletes.
 * Cities/regions come from the bundled lists (their ids match the DB), so the
 * city picker stays stable while malls are fully editable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { REGIONS, CITIES, geoName } from '../../data/mock';
import { adminService } from '../../services/adminService';
import { useApp } from '../../context/AppContext';

interface LocRow { id: string; name: string; name_en: string | null; type: 'mall' | 'market'; city_id: string; lat: number; lng: number; }

const ClickMarker: React.FC<{ pos: [number, number]; onMove: (lat: number, lng: number) => void }> = ({ pos, onMove }) => {
    useMapEvents({ click(e) { onMove(e.latlng.lat, e.latlng.lng); } });
    return pos[0] ? <Marker position={pos} draggable eventHandlers={{ dragend: (e) => { const ll = (e.target as any).getLatLng(); onMove(ll.lat, ll.lng); } }} /> : null;
};
const Recenter: React.FC<{ center: [number, number] }> = ({ center }) => {
    const map = useMap();
    useEffect(() => { if (center[0] && center[1]) { try { map.setView(center, 14, { animate: false }); } catch { /* mid-teardown */ } } }, [center[0], center[1]]);
    return null;
};

const blank = (): Partial<LocRow> => ({ id: '', name: '', name_en: '', type: 'mall', city_id: '', lat: 0, lng: 0 });

const AdminLocations: React.FC = () => {
    const { language, customAlert, customConfirm, reloadGeo } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [rows, setRows] = useState<LocRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [form, setForm] = useState<Partial<LocRow> | null>(null);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        const data = await adminService.listLocations();
        setRows(data as LocRow[]);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const cityLabel = (id: string) => { const c = CITIES.find(x => x.id === id); return c ? geoName(c, language) : id; };
    const regionOfCity = (id: string) => { const c = CITIES.find(x => x.id === id); return c ? c.regionId : ''; };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q
            ? rows.filter(r => r.name.toLowerCase().includes(q) || (r.name_en || '').toLowerCase().includes(q) || cityLabel(r.city_id).toLowerCase().includes(q))
            : rows;
        return [...list].sort((a, b) => cityLabel(a.city_id).localeCompare(cityLabel(b.city_id), 'ar') || a.name.localeCompare(b.name, 'ar'));
    }, [rows, search, isRTL]);

    // Cities grouped by region for the picker.
    const citiesByRegion = useMemo(() => REGIONS.map(r => ({
        region: r, cities: CITIES.filter(c => c.regionId === r.id).sort((a, b) => geoName(a, language).localeCompare(geoName(b, language), 'ar')),
    })).filter(g => g.cities.length > 0), [isRTL]);

    const openAdd = () => setForm(blank());
    const openEdit = (r: LocRow) => setForm({ ...r, name_en: r.name_en || '' });

    // When the city changes (or a new mall has no pin yet), default the pin to the city centre.
    const onPickCity = (cityId: string) => {
        const c = CITIES.find(x => x.id === cityId);
        setForm(f => ({ ...f, city_id: cityId, lat: (!f?.lat && c) ? c.lat : f?.lat, lng: (!f?.lng && c) ? c.lng : f?.lng }));
    };

    const save = async () => {
        if (!form) return;
        if (!form.name?.trim()) { await customAlert(t('⚠️ اكتب اسم المول/السوق', '⚠️ Enter a name')); return; }
        if (!form.city_id) { await customAlert(t('⚠️ اختر المدينة', '⚠️ Pick a city')); return; }
        if (!form.lat || !form.lng) { await customAlert(t('⚠️ ثبّت الموقع على الخريطة', '⚠️ Pin the location on the map')); return; }
        setSaving(true);
        const res = await adminService.upsertLocation({
            id: form.id || undefined,
            name: form.name.trim(),
            name_en: form.name_en?.trim() || undefined,
            type: (form.type as 'mall' | 'market') || 'mall',
            city_id: form.city_id,
            lat: Number(form.lat), lng: Number(form.lng),
        });
        setSaving(false);
        if (!res?.success) {
            const m = res?.error === 'bad_city' ? t('المدينة غير صحيحة', 'Invalid city') : (res?.error || t('فشل الحفظ', 'Save failed'));
            await customAlert('❌ ' + m); return;
        }
        await load();
        reloadGeo();           // reflect on the website immediately
        setForm(null);
        await customAlert(t('✅ تم الحفظ', '✅ Saved'));
    };

    const remove = async (r: LocRow) => {
        const ok = await customConfirm(t(`حذف «${r.name}»؟ لن يظهر بعدها في الموقع ولا البوتين.`, `Delete "${r.name}"?`));
        if (!ok) return;
        const res = await adminService.deleteLocation(r.id);
        if (!res?.success) { await customAlert('❌ ' + t('فشل الحذف', 'Delete failed')); return; }
        await load();
        reloadGeo();
    };

    const mapCenter: [number, number] = [Number(form?.lat) || 24.7136, Number(form?.lng) || 46.6753];

    return (
        <div className="space-y-4" dir="rtl">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">🏬 إدارة المولات والأسواق</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        تظهر في الموقع والبوتين معاً. {rows.length} موقعاً.
                    </p>
                </div>
                <button onClick={openAdd} className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl text-sm shadow-md active:scale-95 transition">
                    ➕ إضافة مول/سوق
                </button>
            </div>

            <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="🔎 ابحث باسم المول أو المدينة..."
                className="w-full px-4 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-emerald-500 outline-none"
            />

            {loading ? (
                <div className="py-12 text-center text-[var(--text-secondary)] text-sm">⏳ جارٍ التحميل…</div>
            ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-[var(--text-secondary)] text-sm rounded-2xl border border-dashed border-[var(--border-color)]">
                    {search ? 'لا نتائج للبحث.' : 'لا توجد مواقع بعد — أضف أول مول/سوق.'}
                </div>
            ) : (
                <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden divide-y divide-[var(--border-color)]">
                    {filtered.map(r => (
                        <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 bg-[var(--card-bg)]">
                            <span className="text-lg flex-shrink-0">{r.type === 'market' ? '🛒' : '🏬'}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate">{r.name}</div>
                                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                                    {r.type === 'market' ? 'سوق' : 'مول'} · {cityLabel(r.city_id)} · {geoName(REGIONS.find(x => x.id === regionOfCity(r.city_id)) || { name: '' } as any, language)}
                                </div>
                            </div>
                            <button onClick={() => openEdit(r)} className="text-xs font-bold text-emerald-600 px-2 py-1 flex-shrink-0">✏️ تعديل</button>
                            <button onClick={() => remove(r)} className="text-xs font-bold text-red-500 px-2 py-1 flex-shrink-0">🗑️ حذف</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit modal */}
            {form && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4" onClick={() => !saving && setForm(null)}>
                    <div className="bg-[var(--card-bg)] rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="sticky top-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-4 rounded-t-3xl flex items-center justify-between z-10">
                            <div className="text-lg font-bold">{form.id ? '✏️ تعديل موقع' : '➕ مول/سوق جديد'}</div>
                            <button onClick={() => !saving && setForm(null)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">✕</button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">الاسم (عربي) *</label>
                                    <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        placeholder="مثال: العرب مول" className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">الاسم (English)</label>
                                    <input value={form.name_en || ''} onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                                        placeholder="Al Arab Mall" className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">النوع *</label>
                                    <select value={form.type || 'mall'} onChange={(e) => setForm({ ...form, type: e.target.value as 'mall' | 'market' })}
                                        className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none">
                                        <option value="mall">🏬 مول</option>
                                        <option value="market">🛒 سوق شعبي</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">المدينة *</label>
                                    <select value={form.city_id || ''} onChange={(e) => onPickCity(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none">
                                        <option value="">— اختر —</option>
                                        {citiesByRegion.map(g => (
                                            <optgroup key={g.region.id} label={geoName(g.region, language)}>
                                                {g.cities.map(c => <option key={c.id} value={c.id}>{geoName(c, language)}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">📍 ثبّت الموقع على الخريطة *</label>
                                <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">اضغط على الخريطة أو اسحب الدبّوس لتحديد مكان المول بدقّة.</div>
                                <div className="rounded-2xl overflow-hidden border border-[var(--border-color)]" style={{ height: 240 }}>
                                    {form.city_id || (form.lat && form.lng) ? (
                                        <MapContainer center={mapCenter} zoom={form.lat ? 14 : 11} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" detectRetina={true} maxZoom={19} />
                                            <Recenter center={mapCenter} />
                                            <ClickMarker pos={[Number(form.lat) || 0, Number(form.lng) || 0]} onMove={(lat, lng) => setForm(f => ({ ...f, lat, lng }))} />
                                        </MapContainer>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-xs text-[var(--text-secondary)] bg-[var(--body-bg)]">اختر المدينة أولاً لعرض الخريطة</div>
                                    )}
                                </div>
                                {!!(form.lat && form.lng) && (
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">الإحداثيات: {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</div>
                                )}
                            </div>
                        </div>
                        <div className="sticky bottom-0 bg-[var(--body-bg)] p-3 rounded-b-3xl flex gap-3 border-t border-[var(--border-color)]">
                            <button onClick={() => setForm(null)} disabled={saving} className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl">إلغاء</button>
                            <button onClick={save} disabled={saving} className="flex-[2] py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl disabled:opacity-50">
                                {saving ? 'جارٍ الحفظ...' : '💾 حفظ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminLocations;
