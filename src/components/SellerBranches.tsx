import React, { useEffect, useMemo, useState } from 'react';
import { branchRepository, StoreBranch } from '../repositories/branchRepository';
import { CITIES, REGIONS, LOCATIONS } from '../data/mock';
import { useApp } from '../context/AppContext';

interface Props {
    merchantId: string;
    isRTL: boolean;
    customAlert: (m: string) => Promise<void>;
    customConfirm: (m: string) => Promise<boolean>;
}

const empty: Partial<StoreBranch> = {
    nameAr: '', nameEn: '',
    regionId: '', cityId: '', locationId: '',
    address: '', phone: '',
    isPrimary: false, isActive: true
};

const SellerBranches: React.FC<Props> = ({ merchantId, isRTL, customAlert, customConfirm }) => {
    const { platformSettings } = useApp();
    const [branches, setBranches] = useState<StoreBranch[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<Partial<StoreBranch> | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        setLoading(true);
        setBranches(await branchRepository.listForMerchant(merchantId));
        setLoading(false);
    };
    useEffect(() => { refresh(); }, [merchantId]);

    const cities = useMemo(() => draft?.regionId ? CITIES.filter(c => c.regionId === draft.regionId) : [], [draft?.regionId]);
    const malls = useMemo(() => draft?.cityId ? LOCATIONS.filter(l => l.cityId === draft.cityId) : [], [draft?.cityId]);

    const activeCount = branches.filter(b => b.isActive).length;
    const included = platformSettings.includedBranches || 3;
    const extra = Math.max(0, activeCount - included);
    const extraFee = extra * (platformSettings.extraBranchFeeSar || 25);

    const save = async () => {
        if (!draft || !draft.nameAr?.trim()) {
            await customAlert(isRTL ? 'اسم الفرع مطلوب' : 'Branch name required');
            return;
        }
        setBusy(true);
        try {
            if (draft.id) {
                await branchRepository.update(draft.id, draft);
            } else {
                await branchRepository.create({ ...draft, merchantId } as any);
            }
            setDraft(null);
            await refresh();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        } finally { setBusy(false); }
    };

    const remove = async (id: string) => {
        const ok = await customConfirm(isRTL ? 'حذف هذا الفرع؟' : 'Delete this branch?');
        if (!ok) return;
        await branchRepository.delete(id);
        refresh();
    };
    const toggle = async (b: StoreBranch) => {
        await branchRepository.update(b.id, { isActive: !b.isActive });
        refresh();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
                background: extra > 0 ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : 'var(--card-bg, white)',
                border: extra > 0 ? '1.5px solid #fbbf24' : '1px solid var(--border-color)',
                borderRadius: 16, padding: 16
            }}>
                <h3 style={{ margin: '0 0 6px', fontWeight: 900 }}>🏬 {isRTL ? 'فروع متجرك' : 'Your branches'}</h3>
                <div style={{ fontSize: '0.85rem', color: extra > 0 ? '#78350f' : 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.6 }}>
                    {isRTL
                        ? `لديك ${activeCount} فرعاً نشطاً. الباقة الأساسية تشمل ${included} فروع.`
                        : `You have ${activeCount} active branch${activeCount === 1 ? '' : 'es'}. Basic plan covers ${included}.`}
                    {extra > 0 && (
                        <span style={{ display: 'block', marginTop: 4, fontWeight: 900 }}>
                            {isRTL
                                ? `+ ${extra} فرع إضافي = ${extraFee} ر.س / شهرياً تُضاف للفاتورة.`
                                : `+ ${extra} extra branch(es) = ${extraFee} SAR / month added to invoice.`}
                        </span>
                    )}
                </div>
                <button onClick={() => setDraft({ ...empty })} style={{
                    width: '100%', marginTop: 12, padding: 12, borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', color: 'white',
                    fontWeight: 900, cursor: 'pointer'
                }}>
                    + {isRTL ? 'إضافة فرع جديد' : 'Add new branch'}
                </button>
            </div>

            {loading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
            ) : branches.length === 0 ? (
                <div style={{ background: 'var(--card-bg, white)', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    {isRTL ? 'لم تُسجل فروعاً بعد. أضف فرعك الرئيسي للبدء.' : 'No branches yet. Add your primary branch to get started.'}
                </div>
            ) : branches.map(b => (
                <div key={b.id} style={{
                    background: 'var(--card-bg, white)', border: '1px solid var(--border-color)',
                    borderRadius: 14, padding: 14
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontWeight: 900 }}>{b.nameAr}</div>
                        <span style={{
                            background: b.isActive ? '#dcfce7' : '#f1f5f9',
                            color: b.isActive ? '#166534' : '#6b7280',
                            padding: '3px 10px', borderRadius: 999,
                            fontSize: '0.7rem', fontWeight: 800
                        }}>{b.isActive ? (isRTL ? 'نشط' : 'Active') : (isRTL ? 'موقوف' : 'Inactive')}</span>
                    </div>
                    {b.address && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700 }}>📍 {b.address}</div>}
                    {b.phone && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700 }}>📞 {b.phone}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button onClick={() => setDraft(b)} style={chipBtn}>{isRTL ? '✏️ تعديل' : '✏️ Edit'}</button>
                        <button onClick={() => toggle(b)} style={chipBtn}>{b.isActive ? (isRTL ? '⏸️ إيقاف' : '⏸️ Pause') : (isRTL ? '▶️ تفعيل' : '▶️ Activate')}</button>
                        <button onClick={() => remove(b.id)} style={{ ...chipBtn, background: '#fee2e2', color: '#b91c1c' }}>
                            {isRTL ? '🗑️ حذف' : '🗑️ Delete'}
                        </button>
                    </div>
                </div>
            ))}

            {draft && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
                    <div style={{ background: 'var(--card-bg, white)', borderRadius: 22, padding: 22, width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'auto' }}>
                        <h3 style={{ margin: '0 0 14px', fontWeight: 900 }}>
                            {draft.id ? (isRTL ? '✏️ تعديل فرع' : '✏️ Edit branch') : (isRTL ? '➕ فرع جديد' : '➕ New branch')}
                        </h3>
                        <Field label={isRTL ? 'اسم الفرع (عربي) *' : 'Branch name (AR) *'}>
                            <input value={draft.nameAr || ''} onChange={e => setDraft({ ...draft, nameAr: e.target.value })} style={inputStyle} />
                        </Field>
                        <Field label={isRTL ? 'اسم الفرع (إنجليزي)' : 'Branch name (EN)'}>
                            <input value={draft.nameEn || ''} onChange={e => setDraft({ ...draft, nameEn: e.target.value })} style={inputStyle} dir="ltr" />
                        </Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <Field label={isRTL ? 'المنطقة' : 'Region'}>
                                <select value={draft.regionId || ''} onChange={e => setDraft({ ...draft, regionId: e.target.value, cityId: '', locationId: '' })} style={inputStyle}>
                                    <option value="">{isRTL ? '— اختر —' : '— select —'}</option>
                                    {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </Field>
                            <Field label={isRTL ? 'المدينة' : 'City'}>
                                <select value={draft.cityId || ''} onChange={e => setDraft({ ...draft, cityId: e.target.value, locationId: '' })} style={inputStyle} disabled={!draft.regionId}>
                                    <option value="">{isRTL ? '— اختر —' : '— select —'}</option>
                                    {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </Field>
                        </div>
                        <Field label={isRTL ? 'المول/السوق' : 'Mall / market'}>
                            <select value={draft.locationId || ''} onChange={e => setDraft({ ...draft, locationId: e.target.value })} style={inputStyle} disabled={!draft.cityId}>
                                <option value="">{isRTL ? '— اختر —' : '— select —'}</option>
                                {malls.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </Field>
                        <Field label={isRTL ? 'العنوان التفصيلي' : 'Address'}>
                            <input value={draft.address || ''} onChange={e => setDraft({ ...draft, address: e.target.value })} style={inputStyle} />
                        </Field>
                        <Field label={isRTL ? 'هاتف الفرع' : 'Branch phone'}>
                            <input value={draft.phone || ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} style={inputStyle} dir="ltr" />
                        </Field>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setDraft(null)} style={{ ...chipBtn, flex: 1, padding: 12 }}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                            <button onClick={save} disabled={busy} style={{ flex: 1.4, padding: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', color: 'white', fontWeight: 900, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                                {busy ? '…' : (isRTL ? 'حفظ' : 'Save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#475569', marginBottom: 6 }}>{label}</label>
        {children}
    </div>
);
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border-color)',
    fontSize: '0.95rem', fontWeight: 600, outline: 'none', background: 'var(--card-bg, white)',
    color: 'var(--text-primary)', boxSizing: 'border-box'
};
const chipBtn: React.CSSProperties = {
    background: '#f1f5f9', color: '#0f172a', border: 'none', padding: '8px 12px',
    borderRadius: 10, fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer'
};

export default SellerBranches;
