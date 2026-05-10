import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { promoRepository, PromoCampaign } from '../repositories/promoRepository';
import {
    subscriptionRepository, MerchantSubscription, SubscriptionPlan
} from '../repositories/subscriptionRepository';
import {
    sponsorshipRepository, pinnedStoreRepository, Sponsorship, PinnedStore, SponsorshipType
} from '../repositories/sponsorshipRepository';
import { platformSettingsRepository, PlatformSettings } from '../repositories/platformSettingsRepository';
import BottomNav from '../components/BottomNav';

type Audience = 'buyer' | 'seller' | 'all';
type Tab = 'stores' | 'sponsorships' | 'pinned' | 'campaigns' | 'settings' | 'preview' | 'help';

interface CampaignDraft {
    id?: string;
    targetAudience: Audience;
    titleAr: string;
    titleEn: string;
    bodyAr: string;
    bodyEn: string;
    actionLabelAr: string;
    actionLabelEn: string;
    actionUrl: string;
    imageUrl: string;
    startsAt: string;
    endsAt: string;
    priority: number;
    isActive: boolean;
}

const emptyDraft: CampaignDraft = {
    targetAudience: 'buyer',
    titleAr: '', titleEn: '',
    bodyAr: '', bodyEn: '',
    actionLabelAr: '', actionLabelEn: '',
    actionUrl: '', imageUrl: '',
    startsAt: '', endsAt: '',
    priority: 0, isActive: true
};

const isoToLocal = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (local: string): string | null => local ? new Date(local).toISOString() : null;

const Admin: React.FC = () => {
    const { user, language, customAlert, customConfirm, viewAs, setViewAs } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';

    const [tab, setTab] = useState<Tab>('stores');

    useEffect(() => {
        if (!user) { history.replace('/register'); return; }
        if (user.userType !== 'admin') history.replace('/');
    }, [user, history]);

    if (!user || user.userType !== 'admin') return null;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-color)', direction: isRTL ? 'rtl' : 'ltr', paddingBottom: 100 }}>
            <div style={{
                background: 'linear-gradient(135deg, #0f172a, #334155)',
                color: 'white', padding: '24px 20px 32px',
                borderBottomLeftRadius: 28, borderBottomRightRadius: 28
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900 }}>
                        🛡️ {isRTL ? 'لوحة الأدمن — المرحلة ٢' : 'Admin Console — Phase 2'}
                    </h1>
                    <button onClick={() => history.push('/')} style={{
                        background: 'rgba(100, 100, 100, 0.15)', border: 'none', color: 'white',
                        padding: '8px 14px', borderRadius: 12, fontWeight: 800, cursor: 'pointer'
                    }}>
                        {isRTL ? '🏠 الرئيسية' : '🏠 Home'}
                    </button>
                </div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem', fontWeight: 600 }}>
                    {isRTL
                        ? 'إدارة المتاجر، الاشتراكات، الرعاة، التثبيت، والإعدادات.'
                        : 'Manage merchants, subscriptions, sponsors, pins, and settings.'}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '16px 16px 0', overflowX: 'auto' }} className="hide-scrollbar">
                <TabBtn active={tab === 'stores'}       onClick={() => setTab('stores')}       label={isRTL ? '🏪 المتاجر' : '🏪 Stores'} />
                <TabBtn active={tab === 'sponsorships'} onClick={() => setTab('sponsorships')} label={isRTL ? '⭐ الرعاة' : '⭐ Sponsors'} />
                <TabBtn active={tab === 'pinned'}       onClick={() => setTab('pinned')}       label={isRTL ? '📌 التثبيت' : '📌 Pinned'} />
                <TabBtn active={tab === 'campaigns'}    onClick={() => setTab('campaigns')}    label={isRTL ? '📢 الحملات' : '📢 Campaigns'} />
                <TabBtn active={tab === 'settings'}     onClick={() => setTab('settings')}     label={isRTL ? '⚙️ الإعدادات' : '⚙️ Settings'} />
                <TabBtn active={tab === 'preview'}      onClick={() => setTab('preview')}      label={isRTL ? '👁️ معاينة' : '👁️ Preview'} />
                <TabBtn active={tab === 'help'}         onClick={() => setTab('help')}         label={isRTL ? '❔ شرح' : '❔ Help'} />
            </div>

            <div style={{ padding: 16 }}>
                {tab === 'stores'       && <StoresTab isRTL={isRTL} customAlert={customAlert} customConfirm={customConfirm} />}
                {tab === 'sponsorships' && <SponsorshipsTab isRTL={isRTL} customAlert={customAlert} customConfirm={customConfirm} adminId={user.id} />}
                {tab === 'pinned'       && <PinnedTab isRTL={isRTL} customAlert={customAlert} customConfirm={customConfirm} adminId={user.id} />}
                {tab === 'campaigns'    && <CampaignsTab isRTL={isRTL} customAlert={customAlert} customConfirm={customConfirm} userId={user.id} />}
                {tab === 'settings'     && <SettingsTab isRTL={isRTL} customAlert={customAlert} />}
                {tab === 'preview'      && <PreviewTab isRTL={isRTL} viewAs={viewAs} setViewAs={setViewAs} />}
                {tab === 'help'         && <HelpPanel isRTL={isRTL} />}
            </div>

            <BottomNav />
        </div>
    );
};

// ────────────────────────────────────────────────────────────────────
// Stores tab — bulk-grant subscriptions to N merchants in one click.
// ────────────────────────────────────────────────────────────────────
const StoresTab: React.FC<{
    isRTL: boolean;
    customAlert: (m: string) => Promise<void>;
    customConfirm: (m: string) => Promise<boolean>;
}> = ({ isRTL, customAlert, customConfirm }) => {
    const [rows, setRows] = useState<Array<{ merchant: any; subscription: MerchantSubscription | null; plan: SubscriptionPlan | null }>>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'frozen' | 'gifted'>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [grantOpen, setGrantOpen] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        const data = await subscriptionRepository.listAllMerchantsWithSubscription();
        setRows(data);
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r => {
            if (filter !== 'all' && r.subscription?.status !== filter) return false;
            if (!q) return true;
            const m = r.merchant;
            return [m.name, m.shop, m.phone, m.email, m.address, m.id]
                .filter(Boolean)
                .some((f: string) => f.toLowerCase().includes(q));
        });
    }, [rows, search, filter]);

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const allOnPage = filtered.every(r => selected.has(r.merchant.id)) && filtered.length > 0;
    const toggleAllOnPage = () => {
        setSelected(prev => {
            const next = new Set(prev);
            if (allOnPage) filtered.forEach(r => next.delete(r.merchant.id));
            else filtered.forEach(r => next.add(r.merchant.id));
            return next;
        });
    };

    const handleRevoke = async (merchantId: string) => {
        const ok = await customConfirm(isRTL ? 'هل تريد تعليق اشتراك هذا التاجر؟' : 'Suspend this merchant?');
        if (!ok) return;
        try {
            await subscriptionRepository.revoke(merchantId);
            await customAlert(isRTL ? '✅ تم التعليق' : '✅ Suspended');
            refresh();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        }
    };

    return (
        <div>
            {/* Top bar */}
            <div style={{
                background: 'var(--card-bg, white)', borderRadius: 16, padding: 14, marginBottom: 14,
                boxShadow: '0 4px 12px rgba(0,0,0,0.04)'
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={isRTL ? '🔍 ابحث بالاسم، السجل، المدينة، أو الإيميل…' : '🔍 Search by name, ID, city, email…'}
                        style={inputStyle}
                    />
                    <select value={filter} onChange={e => setFilter(e.target.value as any)} style={{ ...inputStyle, width: 'auto' }}>
                        <option value="all">{isRTL ? 'الكل' : 'All'}</option>
                        <option value="trial">{isRTL ? 'تجريبي' : 'Trial'}</option>
                        <option value="active">{isRTL ? 'نشط' : 'Active'}</option>
                        <option value="frozen">{isRTL ? 'مجمّد' : 'Frozen'}</option>
                        <option value="gifted">{isRTL ? 'منحة' : 'Gifted'}</option>
                    </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {isRTL ? `${filtered.length} متجر${filtered.length === 1 ? '' : 'اً'} • ${selected.size} محدد` : `${filtered.length} merchants • ${selected.size} selected`}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={toggleAllOnPage} style={btnGhost}>
                            {allOnPage ? (isRTL ? 'إلغاء التحديد' : 'Deselect') : (isRTL ? 'تحديد الجميع' : 'Select all')}
                        </button>
                        <button
                            disabled={selected.size === 0}
                            onClick={() => setGrantOpen(true)}
                            style={{ ...btnPrimary, padding: '8px 16px', opacity: selected.size === 0 ? 0.4 : 1 }}>
                            {isRTL ? `🎁 منح سريع (${selected.size})` : `🎁 Grant access (${selected.size})`}
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <Loading isRTL={isRTL} />
            ) : filtered.length === 0 ? (
                <Empty label={isRTL ? 'لا توجد نتائج' : 'No results'} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(r => (
                        <StoreRow
                            key={r.merchant.id}
                            row={r}
                            isRTL={isRTL}
                            checked={selected.has(r.merchant.id)}
                            onToggle={() => toggle(r.merchant.id)}
                            onRevoke={() => handleRevoke(r.merchant.id)}
                        />
                    ))}
                </div>
            )}

            {grantOpen && (
                <GrantAccessModal
                    isRTL={isRTL}
                    merchantIds={Array.from(selected)}
                    onClose={() => setGrantOpen(false)}
                    onDone={async () => {
                        setSelected(new Set());
                        setGrantOpen(false);
                        await refresh();
                        await customAlert(isRTL ? '✅ تم تطبيق المنحة' : '✅ Grant applied');
                    }}
                    customAlert={customAlert}
                />
            )}
        </div>
    );
};

const StoreRow: React.FC<{
    row: { merchant: any; subscription: MerchantSubscription | null; plan: SubscriptionPlan | null };
    isRTL: boolean;
    checked: boolean;
    onToggle: () => void;
    onRevoke: () => void;
}> = ({ row, isRTL, checked, onToggle, onRevoke }) => {
    const m = row.merchant;
    const s = row.subscription;
    const ends = s?.status === 'trial' ? s.trialEndsAt : s?.currentPeriodEnd;
    const daysLeft = ends ? Math.max(0, Math.ceil((new Date(ends).getTime() - Date.now()) / 86400000)) : null;

    const statusColors: Record<string, string> = {
        trial: '#3b82f6', active: '#10b981', gifted: '#a855f7',
        frozen: '#ef4444', past_due: '#f59e0b', cancelled: '#6b7280'
    };
    const statusLabels: Record<string, { ar: string; en: string }> = {
        trial: { ar: '🎁 تجريبي', en: '🎁 Trial' },
        active: { ar: '✅ نشط', en: '✅ Active' },
        gifted: { ar: '💝 منحة', en: '💝 Gifted' },
        frozen: { ar: '⛔ مجمّد', en: '⛔ Frozen' },
        past_due: { ar: '⏰ متأخر', en: '⏰ Past due' },
        cancelled: { ar: '❌ ملغى', en: '❌ Cancelled' }
    };
    const statusKey = s?.status || 'frozen';

    return (
        <div style={{
            background: 'var(--card-bg, white)', borderRadius: 14, padding: 14,
            border: checked ? '2px solid #3b82f6' : '1px solid var(--border-color)',
            boxShadow: checked ? '0 4px 14px rgba(59,130,246,0.18)' : '0 2px 6px rgba(0,0,0,0.03)',
            display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center'
        }}>
            <input type="checkbox" checked={checked} onChange={onToggle}
                style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#3b82f6' }} />
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.shop || m.name || (isRTL ? 'بدون اسم' : 'Unnamed')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {m.phone && <span>📞 {m.phone}</span>}
                    {m.address && <span>📍 {m.address}</span>}
                    <span>🆔 {m.id.slice(0, 8)}</span>
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                        fontSize: '0.7rem', fontWeight: 800,
                        background: `${statusColors[statusKey]}1a`, color: statusColors[statusKey],
                        padding: '3px 8px', borderRadius: 999
                    }}>
                        {statusLabels[statusKey][isRTL ? 'ar' : 'en']}
                    </span>
                    {daysLeft !== null && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                            {isRTL ? `${daysLeft} يوماً متبقياً` : `${daysLeft} day(s) left`}
                        </span>
                    )}
                    {!!s?.discountPercent && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#b45309', background: '#fef3c7', padding: '3px 8px', borderRadius: 999 }}>
                            {isRTL ? `خصم ${s.discountPercent}%` : `${s.discountPercent}% off`}
                        </span>
                    )}
                    {!!s?.branchesCount && s.branchesCount > 1 && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1e40af', background: '#dbeafe', padding: '3px 8px', borderRadius: 999 }}>
                            🏬 {s.branchesCount}
                        </span>
                    )}
                </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {s?.status !== 'frozen' && (
                    <button onClick={onRevoke} style={btnDanger}>
                        {isRTL ? 'تجميد' : 'Freeze'}
                    </button>
                )}
            </div>
        </div>
    );
};

const GrantAccessModal: React.FC<{
    isRTL: boolean;
    merchantIds: string[];
    onClose: () => void;
    onDone: () => void;
    customAlert: (m: string) => Promise<void>;
}> = ({ isRTL, merchantIds, onClose, onDone, customAlert }) => {
    const [grantType, setGrantType] = useState<'free' | 'discount'>('free');
    const [discount, setDiscount] = useState(50);
    const [duration, setDuration] = useState(30);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const apply = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await subscriptionRepository.grantBulk(merchantIds, grantType, duration,
                grantType === 'discount' ? discount : 0, reason || undefined);
            onDone();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
        }}>
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 22, padding: 22, width: '100%', maxWidth: 460 }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 900 }}>
                    🎁 {isRTL ? `منح وصول لـ ${merchantIds.length} متجر` : `Grant access to ${merchantIds.length} merchant(s)`}
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                    <button onClick={() => setGrantType('free')} style={{
                        ...pillBtn,
                        background: grantType === 'free' ? '#10b981' : '#f1f5f9',
                        color: grantType === 'free' ? 'white' : '#0f172a'
                    }}>{isRTL ? '🎁 اشتراك مجاني' : '🎁 Free'}</button>
                    <button onClick={() => setGrantType('discount')} style={{
                        ...pillBtn,
                        background: grantType === 'discount' ? '#f59e0b' : '#f1f5f9',
                        color: grantType === 'discount' ? 'white' : '#0f172a'
                    }}>{isRTL ? '٪ خصم نسبة' : '% Discount'}</button>
                </div>

                {grantType === 'discount' && (
                    <Field label={isRTL ? `نسبة الخصم: ${discount}%` : `Discount: ${discount}%`}>
                        <input type="range" min={5} max={100} step={5} value={discount}
                            onChange={e => setDiscount(Number(e.target.value))}
                            style={{ width: '100%' }} />
                    </Field>
                )}

                <Field label={isRTL ? 'مدة العرض' : 'Duration'}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                            { d: 7, ar: 'أسبوع', en: '1 week' },
                            { d: 30, ar: 'شهر', en: '1 month' },
                            { d: 90, ar: '3 أشهر', en: '3 months' },
                            { d: 180, ar: '6 أشهر', en: '6 months' },
                            { d: 365, ar: 'سنة', en: '1 year' }
                        ].map(p => (
                            <button key={p.d} onClick={() => setDuration(p.d)}
                                style={{
                                    ...pillBtn, padding: '8px 12px',
                                    background: duration === p.d ? '#3b82f6' : '#e2e8f0',
                                    color: duration === p.d ? 'white' : '#0f172a'
                                }}>
                                {isRTL ? p.ar : p.en}
                            </button>
                        ))}
                    </div>
                    <input type="number" min={1} value={duration}
                        onChange={e => setDuration(Math.max(1, Number(e.target.value) || 1))}
                        style={{ ...inputStyle, marginTop: 8 }}
                        placeholder={isRTL ? 'مدة مخصصة (أيام)' : 'Custom days'}
                    />
                </Field>

                <Field label={isRTL ? 'سبب المنحة (اختياري)' : 'Reason (optional)'}>
                    <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle}
                        placeholder={isRTL ? 'مثال: شراكة النخيل مول' : 'e.g. Nakheel mall partnership'} />
                </Field>

                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: 12 }}>
                        {isRTL ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button onClick={apply} disabled={busy}
                        style={{ ...btnPrimary, flex: 1.4, opacity: busy ? 0.6 : 1 }}>
                        {busy ? (isRTL ? 'جاري التطبيق…' : 'Applying…') : (isRTL ? 'تطبيق فوري ⚡' : 'Apply now ⚡')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────────────────────────────
// Sponsorships tab — sponsored deals, top sliders, inline banners.
// ────────────────────────────────────────────────────────────────────
const SponsorshipsTab: React.FC<{
    isRTL: boolean;
    customAlert: (m: string) => Promise<void>;
    customConfirm: (m: string) => Promise<boolean>;
    adminId: string;
}> = ({ isRTL, customAlert, customConfirm, adminId }) => {
    const [items, setItems] = useState<Sponsorship[]>([]);
    const [loading, setLoading] = useState(true);
    const [type, setType] = useState<SponsorshipType>('top_slider');
    const [editing, setEditing] = useState<Partial<Sponsorship> | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        const all = await sponsorshipRepository.listAll();
        setItems(all);
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const beginNew = () => setEditing({
        type, isActive: true, priority: 0,
        badgeLabelAr: 'برعاية', badgeLabelEn: 'Sponsored',
        insertionInterval: 4
    });

    const save = async () => {
        if (!editing) return;
        try {
            if (editing.id) {
                await sponsorshipRepository.update(editing.id, editing as any);
            } else {
                await sponsorshipRepository.create({ ...editing, type: editing.type as SponsorshipType, createdBy: adminId } as any);
            }
            setEditing(null);
            await refresh();
            await customAlert(isRTL ? '✅ تم الحفظ' : '✅ Saved');
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        }
    };

    const remove = async (id: string) => {
        const ok = await customConfirm(isRTL ? 'حذف هذا الإعلان نهائياً؟' : 'Delete this ad permanently?');
        if (!ok) return;
        await sponsorshipRepository.delete(id);
        await refresh();
    };
    const toggle = async (s: Sponsorship) => {
        await sponsorshipRepository.update(s.id, { isActive: !s.isActive });
        await refresh();
    };

    return (
        <div>
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 14, marginBottom: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {(['top_slider', 'inline_banner', 'sponsored_deal', 'native_ad', 'verified_badge'] as SponsorshipType[]).map(t => (
                        <button key={t} onClick={() => setType(t)} style={{
                            ...pillBtn,
                            background: type === t ? '#3b82f6' : '#e2e8f0',
                            color: type === t ? 'white' : '#0f172a'
                        }}>{labelForType(t, isRTL)}</button>
                    ))}
                </div>
                <button onClick={beginNew} style={{ ...btnPrimary, padding: 10 }}>
                    + {isRTL ? `إنشاء ${labelForType(type, isRTL)}` : `New ${labelForType(type, isRTL)}`}
                </button>
            </div>

            {loading ? <Loading isRTL={isRTL} /> :
             items.filter(i => i.type === type).length === 0 ? <Empty label={isRTL ? 'لا يوجد عناصر' : 'No items'} /> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {items.filter(i => i.type === type).map(i => (
                        <SponsorshipRow key={i.id} item={i} isRTL={isRTL}
                            onEdit={() => setEditing(i)} onToggle={() => toggle(i)} onDelete={() => remove(i.id)} />
                    ))}
                </div>}

            {editing && (
                <SponsorshipModal
                    isRTL={isRTL}
                    draft={editing}
                    setDraft={setEditing as any}
                    onClose={() => setEditing(null)}
                    onSave={save}
                />
            )}
        </div>
    );
};

const labelForType = (t: SponsorshipType, isRTL: boolean) => ({
    top_slider:     { ar: '🎯 شريط علوي', en: '🎯 Top Slider' },
    inline_banner:  { ar: '📢 بنر بيني', en: '📢 Inline Banner' },
    sponsored_deal: { ar: '⭐ عرض راعٍ', en: '⭐ Sponsored Deal' },
    native_ad:      { ar: '📰 إعلان مدمج', en: '📰 Native Ad' },
    verified_badge: { ar: '🛡️ شارة توثيق', en: '🛡️ Verified Badge' }
}[t][isRTL ? 'ar' : 'en']);

const SponsorshipRow: React.FC<{
    item: Sponsorship; isRTL: boolean;
    onEdit: () => void; onToggle: () => void; onDelete: () => void;
}> = ({ item, isRTL, onEdit, onToggle, onDelete }) => (
    <div style={{ background: 'var(--card-bg, white)', borderRadius: 14, padding: 14, border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900 }}>{(isRTL ? item.titleAr : item.titleEn) || (isRTL ? '(بدون عنوان)' : '(No title)')}</div>
                {(item.bodyAr || item.bodyEn) && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                        {isRTL ? item.bodyAr : item.bodyEn}
                    </div>
                )}
            </div>
            <span style={{
                fontSize: '0.7rem', fontWeight: 800,
                background: item.isActive ? '#10b981' : '#94a3b8', color: 'white',
                padding: '3px 8px', borderRadius: 999
            }}>{item.isActive ? (isRTL ? 'نشط' : 'Live') : (isRTL ? 'موقوف' : 'Paused')}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 10, flexWrap: 'wrap' }}>
            <span>👁️ {item.impressions}</span>
            <span>👆 {item.clicks}</span>
            <span>⭐ {item.priority}</span>
            {item.targetCity && <span>📍 {item.targetCity}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={onToggle} style={btnSmallNeutral}>{item.isActive ? (isRTL ? '⏸️ إيقاف' : '⏸️ Pause') : (isRTL ? '▶️ تفعيل' : '▶️ Activate')}</button>
            <button onClick={onEdit} style={btnSmallNeutral}>{isRTL ? '✏️ تعديل' : '✏️ Edit'}</button>
            <button onClick={onDelete} style={btnSmallDanger}>{isRTL ? '🗑️ حذف' : '🗑️ Delete'}</button>
        </div>
    </div>
);

const SponsorshipModal: React.FC<{
    isRTL: boolean;
    draft: Partial<Sponsorship>;
    setDraft: (d: Partial<Sponsorship>) => void;
    onClose: () => void;
    onSave: () => void;
}> = ({ isRTL, draft, setDraft, onClose, onSave }) => (
    <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
    }}>
        <div style={{ background: 'var(--card-bg, white)', borderRadius: 22, padding: 22, width: '100%', maxWidth: 500, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 900 }}>
                {draft.id ? (isRTL ? '✏️ تعديل' : '✏️ Edit') : (isRTL ? '➕ جديد' : '➕ New')} — {labelForType(draft.type as SponsorshipType, isRTL)}
            </h3>

            <Field label={isRTL ? 'العنوان (عربي)' : 'Title (AR)'}>
                <input value={draft.titleAr || ''} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={isRTL ? 'العنوان (إنجليزي)' : 'Title (EN)'}>
                <input value={draft.titleEn || ''} onChange={e => setDraft({ ...draft, titleEn: e.target.value })} style={inputStyle} dir="ltr" />
            </Field>
            <Field label={isRTL ? 'النص (عربي)' : 'Body (AR)'}>
                <textarea value={draft.bodyAr || ''} onChange={e => setDraft({ ...draft, bodyAr: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
            </Field>
            <Field label={isRTL ? 'النص (إنجليزي)' : 'Body (EN)'}>
                <textarea value={draft.bodyEn || ''} onChange={e => setDraft({ ...draft, bodyEn: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} dir="ltr" />
            </Field>
            <Field label={isRTL ? 'صورة (رابط مباشر)' : 'Image URL'}>
                <input value={draft.imageUrl || ''} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} style={inputStyle} dir="ltr" />
            </Field>
            <Field label={isRTL ? 'رابط الإجراء' : 'Action URL'}>
                <input value={draft.actionUrl || ''} onChange={e => setDraft({ ...draft, actionUrl: e.target.value })} style={inputStyle} dir="ltr" />
            </Field>
            {draft.type === 'sponsored_deal' && (
                <Field label={isRTL ? 'معرّف العرض المراد إبرازه' : 'Deal ID to feature'}>
                    <input value={draft.dealId || ''} onChange={e => setDraft({ ...draft, dealId: e.target.value })} style={inputStyle} dir="ltr" />
                </Field>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={isRTL ? 'الأولوية' : 'Priority'}>
                    <input type="number" value={draft.priority || 0} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })} style={inputStyle} />
                </Field>
                <Field label={isRTL ? 'كل كم بطاقة؟ (للعروض المدمجة)' : 'Insert every N items'}>
                    <input type="number" min={2} value={draft.insertionInterval || 4} onChange={e => setDraft({ ...draft, insertionInterval: Number(e.target.value) || 4 })} style={inputStyle} />
                </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={isRTL ? 'يبدأ' : 'Starts at'}>
                    <input type="datetime-local" value={isoToLocal(draft.startsAt)} onChange={e => setDraft({ ...draft, startsAt: localToIso(e.target.value) || new Date().toISOString() })} style={inputStyle} />
                </Field>
                <Field label={isRTL ? 'ينتهي' : 'Ends at'}>
                    <input type="datetime-local" value={isoToLocal(draft.endsAt)} onChange={e => setDraft({ ...draft, endsAt: localToIso(e.target.value) || undefined })} style={inputStyle} />
                </Field>
            </div>
            <Field label={isRTL ? 'مدينة (اختياري)' : 'Target city (optional)'}>
                <input value={draft.targetCity || ''} onChange={e => setDraft({ ...draft, targetCity: e.target.value })} style={inputStyle} />
            </Field>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: '#f1f5f9', cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={!!draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />
                <span style={{ fontWeight: 800 }}>{draft.isActive ? (isRTL ? '🟢 مُفعل' : '🟢 Active') : (isRTL ? '⏸️ موقوف' : '⏸️ Paused')}</span>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: 12 }}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                <button onClick={onSave} style={{ ...btnPrimary, flex: 1.4 }}>{isRTL ? 'حفظ' : 'Save'}</button>
            </div>
        </div>
    </div>
);

// ────────────────────────────────────────────────────────────────────
// Pinned Stores tab
// ────────────────────────────────────────────────────────────────────
const PinnedTab: React.FC<{
    isRTL: boolean;
    customAlert: (m: string) => Promise<void>;
    customConfirm: (m: string) => Promise<boolean>;
    adminId: string;
}> = ({ isRTL, customAlert, customConfirm, adminId }) => {
    const [items, setItems] = useState<PinnedStore[]>([]);
    const [draft, setDraft] = useState<{ storeId: string; targetCity: string; targetMall: string; rank: number; notes: string } | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        setItems(await pinnedStoreRepository.listAll());
        setLoading(false);
    }, []);
    useEffect(() => { refresh(); }, [refresh]);

    const save = async () => {
        if (!draft || !draft.storeId.trim()) return;
        try {
            await pinnedStoreRepository.create({
                storeId: draft.storeId.trim(),
                targetCity: draft.targetCity || undefined,
                targetMall: draft.targetMall || undefined,
                rank: draft.rank,
                startsAt: new Date().toISOString(),
                notes: draft.notes,
                createdBy: adminId
            });
            setDraft(null);
            await refresh();
            await customAlert(isRTL ? '✅ تم التثبيت' : '✅ Pinned');
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        }
    };

    const remove = async (id: string) => {
        const ok = await customConfirm(isRTL ? 'إلغاء التثبيت؟' : 'Unpin?');
        if (!ok) return;
        await pinnedStoreRepository.delete(id);
        refresh();
    };

    return (
        <div>
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 14, marginBottom: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
                <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {isRTL
                        ? 'ثبّت متاجر معينة في صدارة نتائج مدينة أو مول. بدون حد أقصى.'
                        : 'Pin specific stores at the top of a city or mall feed. No cap on count.'}
                </p>
                <button onClick={() => setDraft({ storeId: '', targetCity: '', targetMall: '', rank: 0, notes: '' })} style={{ ...btnPrimary, padding: 10 }}>
                    + {isRTL ? 'تثبيت متجر جديد' : 'Pin a store'}
                </button>
            </div>

            {loading ? <Loading isRTL={isRTL} /> :
             items.length === 0 ? <Empty label={isRTL ? 'لا يوجد متاجر مثبتة' : 'No pinned stores'} /> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {items.map(p => (
                        <div key={p.id} style={{ background: 'var(--card-bg, white)', borderRadius: 14, padding: 12, border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <div style={{ fontWeight: 900 }}>🆔 {p.storeId.slice(0, 16)}…</div>
                                <span style={{ background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 800 }}>
                                    {isRTL ? `الترتيب ${p.rank + 1}` : `Rank ${p.rank + 1}`}
                                </span>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 8 }}>
                                {p.targetCity || (isRTL ? 'كل المدن' : 'all cities')} • {p.targetMall || (isRTL ? 'كل المولات' : 'all malls')}
                                {p.notes ? ` • ${p.notes}` : ''}
                            </div>
                            <button onClick={() => remove(p.id)} style={btnSmallDanger}>{isRTL ? '🗑️ إلغاء التثبيت' : '🗑️ Unpin'}</button>
                        </div>
                    ))}
                </div>}

            {draft && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
                    <div style={{ background: 'var(--card-bg, white)', borderRadius: 22, padding: 22, width: '100%', maxWidth: 460 }}>
                        <h3 style={{ margin: '0 0 14px', fontWeight: 900 }}>📌 {isRTL ? 'تثبيت متجر' : 'Pin store'}</h3>
                        <Field label={isRTL ? 'معرّف المتجر' : 'Store ID'}>
                            <input value={draft.storeId} onChange={e => setDraft({ ...draft, storeId: e.target.value })} style={inputStyle} dir="ltr" />
                        </Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <Field label={isRTL ? 'مدينة' : 'City'}>
                                <input value={draft.targetCity} onChange={e => setDraft({ ...draft, targetCity: e.target.value })} style={inputStyle} />
                            </Field>
                            <Field label={isRTL ? 'مول' : 'Mall'}>
                                <input value={draft.targetMall} onChange={e => setDraft({ ...draft, targetMall: e.target.value })} style={inputStyle} />
                            </Field>
                        </div>
                        <Field label={isRTL ? 'الترتيب (الأقل = أعلى)' : 'Rank (lower = higher)'}>
                            <input type="number" value={draft.rank} onChange={e => setDraft({ ...draft, rank: Number(e.target.value) || 0 })} style={inputStyle} />
                        </Field>
                        <Field label={isRTL ? 'ملاحظات' : 'Notes'}>
                            <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} style={inputStyle} />
                        </Field>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setDraft(null)} style={{ ...btnGhost, flex: 1, padding: 12 }}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                            <button onClick={save} style={{ ...btnPrimary, flex: 1.4 }}>{isRTL ? 'تثبيت' : 'Pin'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ────────────────────────────────────────────────────────────────────
// Settings tab — payment-gateway hide/show toggle and pricing.
// ────────────────────────────────────────────────────────────────────
const SettingsTab: React.FC<{ isRTL: boolean; customAlert: (m: string) => Promise<void> }> = ({ isRTL, customAlert }) => {
    const [s, setS] = useState<PlatformSettings | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => { platformSettingsRepository.fetchAll().then(setS); }, []);

    if (!s) return <Loading isRTL={isRTL} />;

    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await Promise.all([
                platformSettingsRepository.set('payment_gateway_enabled', s.paymentGatewayEnabled),
                platformSettingsRepository.set('payment_gateway_provider', s.paymentGatewayProvider),
                platformSettingsRepository.set('payment_publishable_key', s.paymentPublishableKey),
                platformSettingsRepository.set('basic_plan_price_sar', s.basicPlanPriceSar),
                platformSettingsRepository.set('extra_branch_fee_sar', s.extraBranchFeeSar),
                platformSettingsRepository.set('included_branches', s.includedBranches),
                platformSettingsRepository.set('trial_days', s.trialDays),
                platformSettingsRepository.set('trial_warning_days_before', s.trialWarningDaysBefore)
            ]);
            await customAlert(isRTL ? '✅ تم الحفظ' : '✅ Saved');
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        } finally { setSaving(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: '0 0 6px', fontWeight: 900 }}>💳 {isRTL ? 'بوابة الدفع' : 'Payment Gateway'}</h3>
                <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6 }}>
                    {isRTL
                        ? 'مفتاح واحد لإخفاء/إظهار كل واجهات الدفع في التطبيق. عند الإخفاء يصبح كل شيء مجاناً للجميع.'
                        : 'Single switch to hide/show every payment UI. When hidden, the entire platform behaves as fully free.'}
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: s.paymentGatewayEnabled ? '#fee2e2' : '#dcfce7', borderRadius: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.paymentGatewayEnabled} onChange={e => setS({ ...s, paymentGatewayEnabled: e.target.checked })}
                        style={{ width: 22, height: 22 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900 }}>
                            {s.paymentGatewayEnabled
                                ? (isRTL ? '💳 الدفع مفعّل — التجار يدفعون' : '💳 Payments ENABLED — merchants pay')
                                : (isRTL ? '🆓 الدفع مخفي — المنصة مجانية' : '🆓 Payments HIDDEN — platform is free')}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {isRTL ? 'يعمل لحظياً على جميع الأجهزة دون إعادة نشر.' : 'Updates instantly on every device, no redeploy.'}
                        </div>
                    </div>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                    <Field label={isRTL ? 'البوابة' : 'Provider'}>
                        <select value={s.paymentGatewayProvider} onChange={e => setS({ ...s, paymentGatewayProvider: e.target.value as any })} style={inputStyle}>
                            <option value="moyasar">Moyasar</option>
                            <option value="paytabs">PayTabs</option>
                        </select>
                    </Field>
                    <Field label={isRTL ? 'المفتاح العام' : 'Publishable Key'}>
                        <input value={s.paymentPublishableKey} onChange={e => setS({ ...s, paymentPublishableKey: e.target.value })} style={inputStyle} dir="ltr" />
                    </Field>
                </div>
            </div>

            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: '0 0 14px', fontWeight: 900 }}>💰 {isRTL ? 'تسعير الباقة الأساسية' : 'Basic plan pricing'}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <Field label={isRTL ? 'السعر الشهري (ر.س)' : 'Monthly (SAR)'}>
                        <input type="number" value={s.basicPlanPriceSar} onChange={e => setS({ ...s, basicPlanPriceSar: Number(e.target.value) || 0 })} style={inputStyle} />
                    </Field>
                    <Field label={isRTL ? 'فروع مشمولة' : 'Included branches'}>
                        <input type="number" value={s.includedBranches} onChange={e => setS({ ...s, includedBranches: Number(e.target.value) || 1 })} style={inputStyle} />
                    </Field>
                    <Field label={isRTL ? 'سعر الفرع الإضافي (ر.س)' : 'Extra branch fee (SAR)'}>
                        <input type="number" value={s.extraBranchFeeSar} onChange={e => setS({ ...s, extraBranchFeeSar: Number(e.target.value) || 0 })} style={inputStyle} />
                    </Field>
                </div>
            </div>

            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: '0 0 14px', fontWeight: 900 }}>🎁 {isRTL ? 'الفترة التجريبية' : 'Trial period'}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label={isRTL ? 'عدد أيام التجربة' : 'Trial days'}>
                        <input type="number" value={s.trialDays} onChange={e => setS({ ...s, trialDays: Number(e.target.value) || 0 })} style={inputStyle} />
                    </Field>
                    <Field label={isRTL ? 'إنذار قبل النهاية (أيام)' : 'Warning days before end'}>
                        <input type="number" value={s.trialWarningDaysBefore} onChange={e => setS({ ...s, trialWarningDaysBefore: Number(e.target.value) || 0 })} style={inputStyle} />
                    </Field>
                </div>
            </div>

            <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, padding: 14 }}>
                {saving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? '💾 حفظ كل الإعدادات' : '💾 Save all settings')}
            </button>
        </div>
    );
};

// ────────────────────────────────────────────────────────────────────
// Existing tabs preserved: Campaigns, Preview, Help
// ────────────────────────────────────────────────────────────────────
const CampaignsTab: React.FC<{
    isRTL: boolean;
    customAlert: (m: string) => Promise<void>;
    customConfirm: (m: string) => Promise<boolean>;
    userId: string;
}> = ({ isRTL, customAlert, customConfirm, userId }) => {
    const [campaigns, setCampaigns] = useState<(PromoCampaign & { currentImpressions?: number })[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<CampaignDraft>(emptyDraft);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        setCampaigns(await promoRepository.listAll() as any);
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const resetDraft = () => { setDraft(emptyDraft); setEditingId(null); };
    const beginEdit = (c: PromoCampaign) => {
        setEditingId(c.id);
        setDraft({
            id: c.id,
            targetAudience: (c.targetAudience as Audience) || 'buyer',
            titleAr: c.titleAr, titleEn: c.titleEn, bodyAr: c.bodyAr, bodyEn: c.bodyEn,
            actionLabelAr: c.actionLabelAr || '', actionLabelEn: c.actionLabelEn || '',
            actionUrl: c.actionUrl || '', imageUrl: c.imageUrl || '',
            startsAt: isoToLocal(c.startsAt), endsAt: isoToLocal(c.endsAt),
            priority: c.priority || 0, isActive: !!c.isActive
        });
    };

    const handleSave = async () => {
        if (!draft.titleAr.trim() || !draft.titleEn.trim() || !draft.bodyAr.trim() || !draft.bodyEn.trim()) {
            await customAlert(isRTL ? 'العنوان والنص مطلوبان بالعربية والإنجليزية' : 'Title and body required (AR + EN)');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                targetAudience: draft.targetAudience,
                titleAr: draft.titleAr, titleEn: draft.titleEn, bodyAr: draft.bodyAr, bodyEn: draft.bodyEn,
                actionLabelAr: draft.actionLabelAr || undefined,
                actionLabelEn: draft.actionLabelEn || undefined,
                actionUrl: draft.actionUrl || undefined,
                imageUrl: draft.imageUrl || undefined,
                startsAt: localToIso(draft.startsAt) || new Date().toISOString(),
                endsAt: localToIso(draft.endsAt) || undefined,
                priority: draft.priority, isActive: draft.isActive
            } as any;
            if (editingId) await promoRepository.updateCampaign(editingId, payload);
            else await promoRepository.createCampaign({ ...payload, createdBy: userId });
            resetDraft();
            await refresh();
            await customAlert(isRTL ? '✅ تم الحفظ' : '✅ Saved');
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        } finally { setSaving(false); }
    };

    const handleToggle = async (c: PromoCampaign) => { await promoRepository.updateCampaign(c.id, { isActive: !c.isActive }); refresh(); };
    const handleDelete = async (c: PromoCampaign) => {
        const ok = await customConfirm(isRTL ? `حذف "${c.titleAr}"؟` : `Delete "${c.titleEn}"?`);
        if (!ok) return;
        await promoRepository.deleteCampaign(c.id); refresh();
    };
    const handleBroadcast = async (c: PromoCampaign) => {
        const ok = await customConfirm(isRTL ? `إرسال "${c.titleAr}" الآن؟` : `Send "${c.titleEn}" now?`);
        if (!ok) return;
        const count = await promoRepository.broadcastNow(c.id);
        await customAlert(isRTL ? `✅ تم إرسال ${count} إشعار.` : `✅ Sent ${count} notifications.`);
        refresh();
    };

    return (
        <>
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 18, padding: 18, marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 900 }}>
                    {editingId ? (isRTL ? '✏️ تعديل حملة' : '✏️ Edit Campaign') : (isRTL ? '➕ حملة جديدة' : '➕ New Campaign')}
                </h3>
                <Field label={isRTL ? 'الجمهور' : 'Audience'}>
                    <select value={draft.targetAudience} onChange={e => setDraft({ ...draft, targetAudience: e.target.value as Audience })} style={inputStyle}>
                        <option value="buyer">{isRTL ? '🛍️ مشترون' : '🛍️ Buyers'}</option>
                        <option value="seller">{isRTL ? '🏬 تجار' : '🏬 Sellers'}</option>
                        <option value="all">{isRTL ? '🌐 الجميع' : '🌐 Everyone'}</option>
                    </select>
                </Field>
                <Field label={isRTL ? 'العنوان (عربي)' : 'Title (AR)'}>
                    <input value={draft.titleAr} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} style={inputStyle} />
                </Field>
                <Field label={isRTL ? 'العنوان (إنجليزي)' : 'Title (EN)'}>
                    <input value={draft.titleEn} onChange={e => setDraft({ ...draft, titleEn: e.target.value })} style={inputStyle} dir="ltr" />
                </Field>
                <Field label={isRTL ? 'النص (عربي)' : 'Body (AR)'}>
                    <textarea value={draft.bodyAr} onChange={e => setDraft({ ...draft, bodyAr: e.target.value })} style={{ ...inputStyle, minHeight: 70 }} />
                </Field>
                <Field label={isRTL ? 'النص (إنجليزي)' : 'Body (EN)'}>
                    <textarea value={draft.bodyEn} onChange={e => setDraft({ ...draft, bodyEn: e.target.value })} style={{ ...inputStyle, minHeight: 70 }} dir="ltr" />
                </Field>
                <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, padding: 12, opacity: saving ? 0.6 : 1, marginTop: 8 }}>
                    {saving ? (isRTL ? 'جاري…' : 'Saving…') : (editingId ? (isRTL ? 'حفظ التعديلات' : 'Save Changes') : (isRTL ? '➕ إنشاء' : '➕ Create'))}
                </button>
                {editingId && <button onClick={resetDraft} style={{ ...btnGhost, padding: 10, marginTop: 8 }}>{isRTL ? 'إلغاء' : 'Cancel'}</button>}
            </div>

            {loading ? <Loading isRTL={isRTL} /> :
             campaigns.length === 0 ? <Empty label={isRTL ? 'لا توجد حملات بعد' : 'No campaigns yet'} /> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {campaigns.map(c => (
                        <div key={c.id} style={{ background: 'var(--card-bg, white)', borderRadius: 14, padding: 14, border: '1px solid var(--border-color)' }}>
                            <div style={{ fontWeight: 900 }}>{isRTL ? c.titleAr : c.titleEn}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{isRTL ? c.bodyAr : c.bodyEn}</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                                <button onClick={() => handleToggle(c)} style={btnSmallNeutral}>{c.isActive ? (isRTL ? '⏸️ إيقاف' : '⏸️ Pause') : (isRTL ? '▶️ تفعيل' : '▶️ Activate')}</button>
                                <button onClick={() => handleBroadcast(c)} style={btnSmallNeutral}>{isRTL ? '📤 إرسال الآن' : '📤 Send Now'}</button>
                                <button onClick={() => beginEdit(c)} style={btnSmallNeutral}>{isRTL ? '✏️ تعديل' : '✏️ Edit'}</button>
                                <button onClick={() => handleDelete(c)} style={btnSmallDanger}>{isRTL ? '🗑️ حذف' : '🗑️ Delete'}</button>
                            </div>
                        </div>
                    ))}
                </div>}
        </>
    );
};

const PreviewTab: React.FC<{ isRTL: boolean; viewAs: any; setViewAs: (v: any) => void }> = ({ isRTL, viewAs, setViewAs }) => {
    const history = useHistory();
    return (
        <div style={{ background: 'var(--card-bg, white)', borderRadius: 20, padding: 20 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900 }}>
                {isRTL ? '👁️ معاينة التطبيق كمستخدم آخر' : '👁️ Preview as another role'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.7 }}>
                {isRTL ? 'دور حسابك (admin) لا يتغير. ستظهر شارة "وضع المعاينة" للرجوع.' : 'Your real role does not change. A preview badge appears to exit.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12 }}>
                <button onClick={() => setViewAs(null)} style={{ ...pillBtn, padding: 12, background: !viewAs ? '#0f172a' : '#f1f5f9', color: !viewAs ? 'white' : '#0f172a' }}>
                    {isRTL ? '🛡️ كأدمن' : '🛡️ Admin'}
                </button>
                <button onClick={() => { setViewAs('buyer'); history.push('/'); }} style={{ ...pillBtn, padding: 12, background: viewAs === 'buyer' ? '#0f172a' : '#f1f5f9', color: viewAs === 'buyer' ? 'white' : '#0f172a' }}>
                    {isRTL ? '🛍️ كمشترٍ' : '🛍️ Buyer'}
                </button>
                <button onClick={() => { setViewAs('seller'); history.push('/seller'); }} style={{ ...pillBtn, padding: 12, background: viewAs === 'seller' ? '#0f172a' : '#f1f5f9', color: viewAs === 'seller' ? 'white' : '#0f172a' }}>
                    {isRTL ? '🏬 كتاجر' : '🏬 Seller'}
                </button>
            </div>
        </div>
    );
};

const HelpPanel: React.FC<{ isRTL: boolean }> = ({ isRTL }) => (
    <div style={{ background: 'var(--card-bg, white)', borderRadius: 20, padding: 22, lineHeight: 1.85 }}>
        {isRTL ? (
            <>
                <h3 style={{ marginTop: 0 }}>دليل المرحلة ٢</h3>
                <ul style={{ paddingInlineStart: 22 }}>
                    <li><b>المتاجر:</b> ابحث، حدّد، ثم استخدم "منح سريع" لمنح اشتراك مجاني أو خصم لمجموعة من التجار في خطوة واحدة.</li>
                    <li><b>الرعاة:</b> أنشئ شريطاً علوياً، بنرات بينية، أو عروضاً مدمجة. كل عرض راعٍ يُحقن تلقائياً في صفحة المشترين.</li>
                    <li><b>التثبيت:</b> ثبّت متاجر معينة في صدارة بحث مدينة أو مول دون حد أقصى.</li>
                    <li><b>الحملات:</b> إشعارات ترويجية تصل لجميع المستهدفين فوراً أو حسب جدول.</li>
                    <li><b>الإعدادات:</b> مفتاح "إخفاء بوابة الدفع" يحوّل التطبيق إلى مجاني بضغطة واحدة.</li>
                </ul>
                <h3>الأمان</h3>
                <ul style={{ paddingInlineStart: 22 }}>
                    <li>كل العمليات الحساسة (المنح، التعليق، تأكيد الدفع) تمر عبر RPC مع SECURITY DEFINER وتفحص دور المستخدم.</li>
                    <li>التجار يرون اشتراكاتهم فقط؛ الإعلانات والتثبيتات قراءة عامة لكن الكتابة محصورة بالأدمن.</li>
                </ul>
            </>
        ) : (
            <>
                <h3 style={{ marginTop: 0 }}>Phase 2 quick guide</h3>
                <ul style={{ paddingInlineStart: 22 }}>
                    <li><b>Stores:</b> search, multi-select, then "Grant access" to bulk-gift free or discounted subscriptions.</li>
                    <li><b>Sponsors:</b> create top sliders, inline banners, sponsored deals or native ads injected into the buyer feed.</li>
                    <li><b>Pinned:</b> pin specific stores to the top of any city or mall feed (no cap).</li>
                    <li><b>Campaigns:</b> push promotional notifications instantly or on schedule.</li>
                    <li><b>Settings:</b> the "hide payment gateway" switch flips the entire platform to free with one click.</li>
                </ul>
            </>
        )}
    </div>
);

// ── Helpers ──
const Loading: React.FC<{ isRTL: boolean }> = ({ isRTL }) => (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>
        {isRTL ? 'جاري التحميل…' : 'Loading…'}
    </div>
);
const Empty: React.FC<{ label: string }> = ({ label }) => (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700, background: 'var(--card-bg, white)', borderRadius: 16 }}>
        {label}
    </div>
);

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
    <button onClick={onClick} style={{
        padding: '10px 16px', borderRadius: 12, border: 'none',
        background: active ? 'var(--primary, #00897b)' : 'var(--card-bg, white)',
        color: active ? 'white' : 'var(--text-primary, #0f172a)',
        fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
        boxShadow: active ? '0 4px 12px rgba(0,137,123,0.3)' : '0 1px 3px rgba(0,0,0,0.05)'
    }}>{label}</button>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#475569', marginBottom: 6 }}>{label}</label>
        {children}
    </div>
);

// ── Styles ──
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 12,
    border: '1.5px solid var(--border-color)', fontSize: '0.95rem', fontWeight: 600,
    outline: 'none', background: 'var(--card-bg, white)', color: 'var(--text-primary, #0f172a)',
    boxSizing: 'border-box'
};
const btnPrimary: React.CSSProperties = {
    width: '100%', padding: 14, borderRadius: 14, border: 'none',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    color: 'white', fontSize: '0.95rem', fontWeight: 900, cursor: 'pointer'
};
const btnGhost: React.CSSProperties = {
    background: 'var(--body-bg)', color: 'var(--text-secondary)', border: 'none',
    padding: '8px 14px', borderRadius: 10, fontWeight: 800, cursor: 'pointer'
};
const btnDanger: React.CSSProperties = {
    background: '#fee2e2', color: '#b91c1c', border: 'none',
    padding: '8px 12px', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: '0.78rem'
};
const btnSmallNeutral: React.CSSProperties = {
    background: 'var(--body-bg)', color: 'var(--text-primary)', border: 'none',
    padding: '8px 12px', borderRadius: 10, fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer'
};
const btnSmallDanger: React.CSSProperties = {
    background: 'rgba(239, 68, 68, 0.15)', color: '#b91c1c', border: 'none',
    padding: '8px 12px', borderRadius: 10, fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer'
};
const pillBtn: React.CSSProperties = {
    border: 'none', padding: '8px 14px', borderRadius: 999, fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer'
};

export default Admin;
