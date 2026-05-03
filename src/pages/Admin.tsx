import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { promoRepository, PromoCampaign } from '../repositories/promoRepository';
import BottomNav from '../components/BottomNav';

type Audience = 'buyer' | 'seller' | 'all';

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
    startsAt: string;  // datetime-local string
    endsAt: string;    // datetime-local string ('' = never expires)
    priority: number;
    isActive: boolean;
}

const emptyDraft: CampaignDraft = {
    targetAudience: 'buyer',
    titleAr: '',
    titleEn: '',
    bodyAr: '',
    bodyEn: '',
    actionLabelAr: '',
    actionLabelEn: '',
    actionUrl: '',
    imageUrl: '',
    startsAt: '',
    endsAt: '',
    priority: 0,
    isActive: true
};

// Convert ISO timestamp ⇄ datetime-local input value
const isoToLocal = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (local: string): string | null => {
    if (!local) return null;
    return new Date(local).toISOString();
};

const Admin: React.FC = () => {
    const { user, language, customAlert, customConfirm, viewAs, setViewAs } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';

    const [tab, setTab] = useState<'campaigns' | 'preview' | 'help'>('campaigns');
    const [campaigns, setCampaigns] = useState<(PromoCampaign & { currentImpressions?: number })[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<CampaignDraft>(emptyDraft);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Guard: only admins reach this page.
    useEffect(() => {
        if (!user) {
            history.replace('/register');
            return;
        }
        if (user.userType !== 'admin') {
            history.replace('/');
        }
    }, [user, history]);

    const refresh = useCallback(async () => {
        setLoading(true);
        const data = await promoRepository.listAll();
        setCampaigns(data as any);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (user?.userType === 'admin') refresh();
    }, [user, refresh]);

    const resetDraft = () => {
        setDraft(emptyDraft);
        setEditingId(null);
    };

    const beginEdit = (c: PromoCampaign) => {
        setEditingId(c.id);
        setDraft({
            id: c.id,
            targetAudience: (c.targetAudience as Audience) || 'buyer',
            titleAr: c.titleAr || '',
            titleEn: c.titleEn || '',
            bodyAr: c.bodyAr || '',
            bodyEn: c.bodyEn || '',
            actionLabelAr: c.actionLabelAr || '',
            actionLabelEn: c.actionLabelEn || '',
            actionUrl: c.actionUrl || '',
            imageUrl: c.imageUrl || '',
            startsAt: isoToLocal(c.startsAt),
            endsAt: isoToLocal(c.endsAt),
            priority: c.priority || 0,
            isActive: !!c.isActive
        });
    };

    const validate = (d: CampaignDraft): string | null => {
        if (!d.titleAr.trim() || !d.titleEn.trim()) return isRTL ? 'العنوان مطلوب بالعربية والإنجليزية' : 'Title required (AR + EN)';
        if (!d.bodyAr.trim() || !d.bodyEn.trim()) return isRTL ? 'النص مطلوب بالعربية والإنجليزية' : 'Body required (AR + EN)';
        if (d.startsAt && d.endsAt && new Date(d.startsAt) >= new Date(d.endsAt)) {
            return isRTL ? 'وقت البداية يجب أن يسبق وقت النهاية' : 'Start must be before end';
        }
        return null;
    };

    const handleSave = async () => {
        const err = validate(draft);
        if (err) { await customAlert(err); return; }
        setSaving(true);
        try {
            if (editingId) {
                await promoRepository.updateCampaign(editingId, {
                    targetAudience: draft.targetAudience,
                    titleAr: draft.titleAr,
                    titleEn: draft.titleEn,
                    bodyAr: draft.bodyAr,
                    bodyEn: draft.bodyEn,
                    actionLabelAr: draft.actionLabelAr || null,
                    actionLabelEn: draft.actionLabelEn || null,
                    actionUrl: draft.actionUrl || null,
                    imageUrl: draft.imageUrl || null,
                    startsAt: localToIso(draft.startsAt) || new Date().toISOString(),
                    endsAt: localToIso(draft.endsAt),
                    priority: draft.priority,
                    isActive: draft.isActive
                });
            } else {
                await promoRepository.createCampaign({
                    targetAudience: draft.targetAudience,
                    titleAr: draft.titleAr,
                    titleEn: draft.titleEn,
                    bodyAr: draft.bodyAr,
                    bodyEn: draft.bodyEn,
                    actionLabelAr: draft.actionLabelAr || undefined,
                    actionLabelEn: draft.actionLabelEn || undefined,
                    actionUrl: draft.actionUrl || undefined,
                    imageUrl: draft.imageUrl || undefined,
                    startsAt: localToIso(draft.startsAt) || new Date().toISOString(),
                    endsAt: localToIso(draft.endsAt) || undefined,
                    priority: draft.priority,
                    isActive: draft.isActive,
                    createdBy: user!.id
                });
            }
            resetDraft();
            await refresh();
            await customAlert(isRTL ? '✅ تم الحفظ' : '✅ Saved');
        } catch (e: any) {
            await customAlert((isRTL ? '❌ فشل الحفظ: ' : '❌ Save failed: ') + (e?.message || e));
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (c: PromoCampaign) => {
        try {
            await promoRepository.updateCampaign(c.id, { isActive: !c.isActive });
            await refresh();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        }
    };

    const handleDelete = async (c: PromoCampaign) => {
        const ok = await customConfirm(isRTL ? `حذف الحملة "${c.titleAr}" نهائياً؟` : `Permanently delete "${c.titleEn}"?`);
        if (!ok) return;
        try {
            await promoRepository.deleteCampaign(c.id);
            await refresh();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ ' : '❌ ') + (e?.message || e));
        }
    };

    const handleBroadcast = async (c: PromoCampaign) => {
        const ok = await customConfirm(isRTL
            ? `إرسال الحملة "${c.titleAr}" الآن لكل المستهدفين فوراً؟`
            : `Send "${c.titleEn}" to every targeted user now?`);
        if (!ok) return;
        try {
            const count = await promoRepository.broadcastNow(c.id);
            await customAlert(isRTL ? `✅ تم إرسال ${count} إشعار.` : `✅ Sent ${count} notifications.`);
            await refresh();
        } catch (e: any) {
            await customAlert((isRTL ? '❌ فشل الإرسال: ' : '❌ Broadcast failed: ') + (e?.message || e));
        }
    };

    const stats = useMemo(() => {
        const total = campaigns.length;
        const active = campaigns.filter(c => c.isActive).length;
        const impressions = campaigns.reduce((s, c) => s + (c.currentImpressions || 0), 0);
        return { total, active, impressions };
    }, [campaigns]);

    if (!user || user.userType !== 'admin') return null;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-color)', direction: isRTL ? 'rtl' : 'ltr', paddingBottom: 100 }}>
            {/* Header */}
            <div style={{
                background: 'linear-gradient(135deg, #0f172a, #334155)',
                color: 'white', padding: '24px 20px 32px',
                borderBottomLeftRadius: 28, borderBottomRightRadius: 28
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900 }}>
                        🛡️ {isRTL ? 'لوحة الأدمن' : 'Admin Console'}
                    </h1>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => history.push('/')} style={{ background: 'rgba(100, 100, 100, 0.15)', border: 'none', color: 'white', padding: '8px 14px', borderRadius: 12, fontWeight: 800, cursor: 'pointer' }}>
                            {isRTL ? '🏠 الرئيسية' : '🏠 Home'}
                        </button>
                    </div>
                </div>

                {/* Stats strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                    <StatCard label={isRTL ? 'الحملات' : 'Campaigns'} value={stats.total} />
                    <StatCard label={isRTL ? 'نشطة' : 'Active'} value={stats.active} accent="var(--accent)" />
                    <StatCard label={isRTL ? 'مشاهدات' : 'Impressions'} value={stats.impressions} accent="#f59e0b" />
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, padding: '16px 16px 0', overflowX: 'auto' }}>
                <TabBtn active={tab === 'campaigns'} onClick={() => setTab('campaigns')} label={isRTL ? '📢 الإشعارات الترويجية' : '📢 Campaigns'} />
                <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} label={isRTL ? '👁️ معاينة كمستخدم' : '👁️ View As'} />
                <TabBtn active={tab === 'help'} onClick={() => setTab('help')} label={isRTL ? '❔ شرح' : '❔ Help'} />
            </div>

            <div style={{ padding: 16 }}>
                {tab === 'campaigns' && (
                    <>
                        {/* Editor */}
                        <div style={{ background: 'var(--card-bg, white)', borderRadius: 20, padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.04))' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900 }}>
                                    {editingId ? (isRTL ? '✏️ تعديل حملة' : '✏️ Edit Campaign') : (isRTL ? '➕ حملة جديدة' : '➕ New Campaign')}
                                </h3>
                                {editingId && (
                                    <button onClick={resetDraft} style={btnGhost}>
                                        {isRTL ? 'إلغاء' : 'Cancel'}
                                    </button>
                                )}
                            </div>

                            <Field label={isRTL ? 'الجمهور المستهدف' : 'Audience'}>
                                <select value={draft.targetAudience} onChange={e => setDraft({ ...draft, targetAudience: e.target.value as Audience })} style={inputStyle}>
                                    <option value="buyer">{isRTL ? '🛍️ المشترون فقط' : '🛍️ Buyers only'}</option>
                                    <option value="seller">{isRTL ? '🏬 التجار فقط' : '🏬 Sellers only'}</option>
                                    <option value="all">{isRTL ? '🌐 الجميع' : '🌐 Everyone'}</option>
                                </select>
                            </Field>

                            <Field label={isRTL ? 'العنوان (عربي)' : 'Title (Arabic)'}>
                                <input value={draft.titleAr} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} style={inputStyle} placeholder={isRTL ? 'مثال: 🛍️ تبي عروض حصرية حولك؟' : 'e.g. 🛍️ Want exclusive deals near you?'} />
                            </Field>
                            <Field label={isRTL ? 'العنوان (إنجليزي)' : 'Title (English)'}>
                                <input value={draft.titleEn} onChange={e => setDraft({ ...draft, titleEn: e.target.value })} style={inputStyle} dir="ltr" />
                            </Field>

                            <Field label={isRTL ? 'النص (عربي)' : 'Body (Arabic)'}>
                                <textarea value={draft.bodyAr} onChange={e => setDraft({ ...draft, bodyAr: e.target.value })} style={{ ...inputStyle, minHeight: 70 }} placeholder={isRTL ? 'النص الذي سيراه المستخدم في الإشعار…' : 'Notification body…'} />
                            </Field>
                            <Field label={isRTL ? 'النص (إنجليزي)' : 'Body (English)'}>
                                <textarea value={draft.bodyEn} onChange={e => setDraft({ ...draft, bodyEn: e.target.value })} style={{ ...inputStyle, minHeight: 70 }} dir="ltr" />
                            </Field>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <Field label={isRTL ? '⏰ يبدأ' : '⏰ Starts at'}>
                                    <input type="datetime-local" value={draft.startsAt} onChange={e => setDraft({ ...draft, startsAt: e.target.value })} style={inputStyle} />
                                </Field>
                                <Field label={isRTL ? '🛑 ينتهي (اختياري)' : '🛑 Ends at (optional)'}>
                                    <input type="datetime-local" value={draft.endsAt} onChange={e => setDraft({ ...draft, endsAt: e.target.value })} style={inputStyle} />
                                </Field>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <Field label={isRTL ? 'زر الإجراء (نص عربي)' : 'CTA Label (AR)'}>
                                    <input value={draft.actionLabelAr} onChange={e => setDraft({ ...draft, actionLabelAr: e.target.value })} style={inputStyle} placeholder={isRTL ? 'مثال: تصفح العروض' : 'e.g. تصفح العروض'} />
                                </Field>
                                <Field label={isRTL ? 'زر الإجراء (نص إنجليزي)' : 'CTA Label (EN)'}>
                                    <input value={draft.actionLabelEn} onChange={e => setDraft({ ...draft, actionLabelEn: e.target.value })} style={inputStyle} dir="ltr" placeholder="Browse Deals" />
                                </Field>
                            </div>

                            <Field label={isRTL ? 'رابط الإجراء (اختياري)' : 'Action URL (optional)'}>
                                <input value={draft.actionUrl} onChange={e => setDraft({ ...draft, actionUrl: e.target.value })} style={inputStyle} dir="ltr" placeholder="/nearby" />
                            </Field>
                            <Field label={isRTL ? 'صورة (اختياري — رابط مباشر)' : 'Image URL (optional)'}>
                                <input value={draft.imageUrl} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} style={inputStyle} dir="ltr" placeholder="https://…" />
                            </Field>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <Field label={isRTL ? 'الأولوية (الأعلى أولاً)' : 'Priority (higher = first)'}>
                                    <input type="number" value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} style={inputStyle} />
                                </Field>
                                <Field label={isRTL ? 'الحالة' : 'Status'}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: draft.isActive ? 'var(--gray-100)' : 'var(--gray-50)', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />
                                        <span style={{ fontWeight: 800, color: draft.isActive ? 'var(--primary)' : 'var(--gray-400)' }}>
                                            {draft.isActive ? (isRTL ? 'مُفعَّلة' : 'Active') : (isRTL ? 'متوقفة' : 'Inactive')}
                                        </span>
                                    </label>
                                </Field>
                            </div>

                            <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, marginTop: 12 }}>
                                {saving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (editingId ? (isRTL ? 'حفظ التعديلات' : 'Save Changes') : (isRTL ? '➕ إنشاء الحملة' : '➕ Create Campaign'))}
                            </button>
                        </div>

                        {/* List */}
                        <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 12 }}>
                            {isRTL ? `📋 الحملات (${campaigns.length})` : `📋 Campaigns (${campaigns.length})`}
                        </h3>

                        {loading ? (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                {isRTL ? 'جاري التحميل…' : 'Loading…'}
                            </div>
                        ) : campaigns.length === 0 ? (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700, background: 'var(--card-bg, white)', borderRadius: 16 }}>
                                {isRTL ? 'لا توجد حملات بعد' : 'No campaigns yet'}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {campaigns.map(c => (
                                    <CampaignRow
                                        key={c.id}
                                        c={c as any}
                                        isRTL={isRTL}
                                        onEdit={() => beginEdit(c)}
                                        onToggle={() => handleToggleActive(c)}
                                        onDelete={() => handleDelete(c)}
                                        onBroadcast={() => handleBroadcast(c)}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}

                {tab === 'preview' && (
                    <div style={{ background: 'var(--card-bg, white)', borderRadius: 20, padding: 20, boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.04))' }}>
                        <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 900 }}>
                            {isRTL ? '👁️ معاينة التطبيق كمستخدم آخر' : '👁️ Preview the app as another role'}
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.7 }}>
                            {isRTL
                                ? 'دور حسابك (admin) لن يتغير. هذا الإعداد يُجبر التطبيق على عرض الواجهة كأنك مشترٍ أو تاجر، حتى تستطيع رؤية ما يراه المستخدم بالضبط.'
                                : 'Your account role (admin) does not change. This forces the UI to render as if you were a buyer or a seller, so you can see exactly what they see.'}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 16 }}>
                            <ViewAsBtn active={!viewAs} onClick={() => setViewAs(null)} label={isRTL ? '🛡️ كأدمن' : '🛡️ As Admin'} />
                            <ViewAsBtn active={viewAs === 'buyer'} onClick={() => { setViewAs('buyer'); history.push('/'); }} label={isRTL ? '🛍️ كمشترٍ' : '🛍️ As Buyer'} />
                            <ViewAsBtn active={viewAs === 'seller'} onClick={() => { setViewAs('seller'); history.push('/seller'); }} label={isRTL ? '🏬 كتاجر' : '🏬 As Seller'} />
                        </div>

                        <div style={{ marginTop: 20, padding: 14, borderRadius: 14, background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.85rem', color: 'var(--secondary)', lineHeight: 1.7 }}>
                            {isRTL
                                ? '💡 ستظهر شارة "وضع المعاينة" في كل صفحة. اضغط عليها للرجوع لوضع الأدمن.'
                                : '💡 A "Preview Mode" badge will appear on every page. Tap it to return to admin view.'}
                        </div>
                    </div>
                )}

                {tab === 'help' && <HelpPanel isRTL={isRTL} />}
            </div>

            <BottomNav />
        </div>
    );
};

// ── Sub-components ──

const StatCard: React.FC<{ label: string, value: number, accent?: string }> = ({ label, value, accent }) => (
    <div style={{ background: 'rgba(80, 80, 90, 0.3)', backdropFilter: 'blur(8px)', borderRadius: 14, padding: '12px 14px', border: '1px solid rgba(100, 100, 100, 0.15)' }}>
        <div style={{ fontSize: '0.7rem', opacity: 0.85, fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: accent || 'white' }}>{value.toLocaleString()}</div>
    </div>
);

const TabBtn: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
    <button onClick={onClick} style={{
        padding: '10px 16px', borderRadius: 12, border: 'none',
        background: active ? 'var(--primary, #00897b)' : 'var(--card-bg, white)',
        color: active ? 'white' : 'var(--text-primary, #0f172a)',
        fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
        boxShadow: active ? '0 4px 12px rgba(0,137,123,0.3)' : '0 1px 3px rgba(0,0,0,0.05)'
    }}>{label}</button>
);

const Field: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#475569', marginBottom: 6 }}>{label}</label>
        {children}
    </div>
);

const ViewAsBtn: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
    <button onClick={onClick} style={{
        padding: '14px 8px', borderRadius: 14, border: 'none',
        background: active ? 'var(--primary, #00897b)' : '#f1f5f9',
        color: active ? 'white' : '#0f172a',
        fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
        boxShadow: active ? '0 4px 14px rgba(0,137,123,0.3)' : 'none'
    }}>{label}</button>
);

interface RowProps {
    c: PromoCampaign & { currentImpressions?: number };
    isRTL: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onDelete: () => void;
    onBroadcast: () => void;
}
const CampaignRow: React.FC<RowProps> = ({ c, isRTL, onEdit, onToggle, onDelete, onBroadcast }) => {
    const now = Date.now();
    const startsAt = new Date(c.startsAt).getTime();
    const endsAt = c.endsAt ? new Date(c.endsAt).getTime() : null;
    let scheduleLabel = '';
    if (!c.isActive) scheduleLabel = isRTL ? '⏸️ متوقفة' : '⏸️ Inactive';
    else if (now < startsAt) scheduleLabel = isRTL ? `⏳ تبدأ ${new Date(c.startsAt).toLocaleString(isRTL ? 'ar-SA' : 'en')}` : `⏳ Starts ${new Date(c.startsAt).toLocaleString()}`;
    else if (endsAt && now > endsAt) scheduleLabel = isRTL ? '🛑 منتهية' : '🛑 Ended';
    else scheduleLabel = isRTL ? '🟢 جارية الآن' : '🟢 Live now';

    const audienceLabel = c.targetAudience === 'buyer' ? (isRTL ? '🛍️ مشترون' : '🛍️ Buyers') :
                          c.targetAudience === 'seller' ? (isRTL ? '🏬 تجار' : '🏬 Sellers') :
                          (isRTL ? '🌐 الجميع' : '🌐 Everyone');

    return (
        <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 16, border: '1px solid var(--border-color, #e2e8f0)', boxShadow: 'var(--shadow-sm, 0 2px 6px rgba(0,0,0,0.04))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 900, fontSize: '1rem', marginBottom: 4 }}>{isRTL ? c.titleAr : c.titleEn}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.5 }}>{isRTL ? c.bodyAr : c.bodyEn}</div>
                </div>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, padding: '4px 10px', borderRadius: 10, background: 'var(--body-bg)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{audienceLabel}</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, fontSize: '0.75rem', color: '#475569', fontWeight: 700 }}>
                <span style={{ padding: '3px 8px', background: 'var(--body-bg)', borderRadius: 8 }}>{scheduleLabel}</span>
                <span style={{ padding: '3px 8px', background: 'var(--body-bg)', borderRadius: 8 }}>👁️ {c.currentImpressions || 0}</span>
                {c.priority > 0 && <span style={{ padding: '3px 8px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: 8, color: 'var(--secondary)' }}>⭐ {c.priority}</span>}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={onToggle} style={{ ...btnSmall, background: c.isActive ? '#fee2e2' : 'var(--gray-100)', color: c.isActive ? '#b91c1c' : 'var(--primary)' }}>
                    {c.isActive ? (isRTL ? '⏸️ إيقاف' : '⏸️ Pause') : (isRTL ? '▶️ تفعيل' : '▶️ Activate')}
                </button>
                <button onClick={onBroadcast} style={{ ...btnSmall, background: '#dbeafe', color: '#1d4ed8' }}>
                    {isRTL ? '📤 إرسال الآن' : '📤 Send Now'}
                </button>
                <button onClick={onEdit} style={{ ...btnSmall, background: 'var(--body-bg)', color: 'var(--text-primary)' }}>
                    {isRTL ? '✏️ تعديل' : '✏️ Edit'}
                </button>
                <button onClick={onDelete} style={{ ...btnSmall, background: 'rgba(239, 68, 68, 0.15)', color: '#b91c1c' }}>
                    {isRTL ? '🗑️ حذف' : '🗑️ Delete'}
                </button>
            </div>
        </div>
    );
};

const HelpPanel: React.FC<{ isRTL: boolean }> = ({ isRTL }) => (
    <div style={{ background: 'var(--card-bg, white)', borderRadius: 20, padding: 22, lineHeight: 1.85, boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.04))' }}>
        {isRTL ? (
            <>
                <h3 style={{ marginTop: 0 }}>كيف تعمل الإشعارات الترويجية؟</h3>
                <ol style={{ paddingInlineStart: 22 }}>
                    <li><b>تكتب الحملة هنا</b> (نص + جمهور + توقيت).</li>
                    <li>تُحفظ في <b>قاعدة البيانات (Supabase)</b> بأمان كامل (RLS تمنع أي شخص آخر من الكتابة فيها).</li>
                    <li>كل مستخدم — حتى لو على جهاز ثاني — التطبيق عنده يفحص كل ٦ ساعات إن كان فيه حملة جديدة تخصه. إن وُجدت، تُعرض له كإشعار داخل التطبيق + إشعار متصفح.</li>
                    <li>إن كنت مستعجلاً، اضغط <b>📤 إرسال الآن</b> — هذا يُرسل الإشعار فوراً لكل المستهدفين بدون انتظار الفحص الدوري.</li>
                </ol>

                <h3>📅 الجدولة التلقائية</h3>
                <p>اكتب حملة الآن، حدّد لها <b>وقت البداية</b> (مثلاً بعد ٣ أيام)، التطبيق سيعرضها تلقائياً عند حلول الوقت بدون أي تدخل منك. حدّد <b>وقت النهاية</b> لإيقافها تلقائياً (مفيد للعروض الموسمية).</p>

                <h3>🔒 الأمان</h3>
                <ul style={{ paddingInlineStart: 22 }}>
                    <li>فقط حسابات بـ <code>user_type = 'admin'</code> تستطيع الكتابة (السياسة على مستوى قاعدة البيانات تمنع غيرهم حتى لو حاولوا التحايل من المتصفح).</li>
                    <li>المستخدم يستلم الحملة مرة واحدة فقط (يُسجَّل في <code>promo_impressions</code>).</li>
                    <li>كل الإشعارات تمر عبر السيرفر — لا شيء على جهازك يستطيع توليد إشعارات وهمية لمستخدمين آخرين.</li>
                </ul>

                <h3>👁️ معاينة كمستخدم</h3>
                <p>تبويب "معاينة" يُلبس التطبيق ثوب مشترٍ أو تاجر مؤقتاً، لكن دور حسابك الحقيقي (admin) لا يتغير. تستخدمه لاختبار تجربة المستخدم النهائي.</p>

                <h3>📡 الإشعارات حين التطبيق مغلق</h3>
                <p>حالياً الإشعارات تصل عند فتح التطبيق في تابة. لتفعيل وصول الإشعارات حتى لو التطبيق مغلق تماماً (Web Push)، يلزم ربط مفاتيح VAPID وخدمة دفع — وهذه خطوة لاحقة عند الحاجة.</p>
            </>
        ) : (
            <>
                <h3 style={{ marginTop: 0 }}>How promotional notifications work</h3>
                <ol style={{ paddingInlineStart: 22 }}>
                    <li><b>You author the campaign here</b> (text + audience + schedule).</li>
                    <li>It is stored in <b>Supabase</b> with strict RLS — only admins can write.</li>
                    <li>Every user's app polls every 6 hours for new campaigns matching their role. When found, it is shown as an in-app + browser notification.</li>
                    <li>For instant delivery, click <b>📤 Send Now</b> — fans the campaign out to every targeted user immediately.</li>
                </ol>

                <h3>📅 Auto-scheduling</h3>
                <p>Set a future <b>Start time</b> — the campaign goes live automatically. Set an <b>End time</b> to auto-deactivate (great for seasonal promos).</p>

                <h3>🔒 Security</h3>
                <ul style={{ paddingInlineStart: 22 }}>
                    <li>Only <code>user_type = 'admin'</code> accounts can write (DB-level RLS).</li>
                    <li>Each user receives a campaign at most once (tracked in <code>promo_impressions</code>).</li>
                    <li>All notifications are emitted server-side — no client can forge them.</li>
                </ul>

                <h3>👁️ View-as preview</h3>
                <p>The Preview tab renders the UI as a buyer or seller without changing your real role.</p>

                <h3>📡 Notifications when app is closed</h3>
                <p>Currently delivered when the app is open in a tab. Web Push (VAPID) for closed-app delivery is a future add-on.</p>
            </>
        )}
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
    color: 'white', fontSize: '1rem', fontWeight: 900, cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(37,99,235,0.3)'
};
const btnGhost: React.CSSProperties = {
    background: 'var(--body-bg)', color: 'var(--text-secondary)', border: 'none',
    padding: '8px 14px', borderRadius: 10, fontWeight: 800, cursor: 'pointer'
};
const btnSmall: React.CSSProperties = {
    border: 'none', padding: '8px 12px', borderRadius: 10,
    fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer'
};

export default Admin;
