import React, { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { userRepository } from '../repositories/userRepository';

// ============================================================================
// Types
// ============================================================================
type SubStatus = 'trial' | 'active' | 'past_due' | 'frozen' | 'cancelled' | 'gifted';

interface Subscription {
  id: string;
  merchant_id: string;
  plan_id: string | null;
  status: SubStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  discount_percent: number;
  branches_count: number;
  cancel_at_period_end: boolean;
}

interface StoreRow {
  id: string;
  name: string;
  shop: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  created_at: string;
  subscription?: Subscription;
}

interface Sponsorship {
  id: string;
  type: 'sponsored_deal' | 'native_ad' | 'top_slider' | 'inline_banner' | 'verified_badge';
  title_ar: string | null;
  title_en: string | null;
  body_ar: string | null;
  image_url: string | null;
  action_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  impressions: number;
  clicks: number;
  priority: number;
  merchant_id: string | null;
}

type Tab = 'overview' | 'stores' | 'sponsorships' | 'settings';

// ============================================================================
// Helpers
// ============================================================================
const STATUS_META: Record<SubStatus, { label: string; bg: string; fg: string; dot: string }> = {
  trial:     { label: 'تجريبي',     bg: '#dbeafe', fg: '#1e40af', dot: '#3b82f6' },
  active:    { label: 'نشط',        bg: '#dcfce7', fg: '#166534', dot: '#16a34a' },
  gifted:    { label: 'هدية',       bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  past_due:  { label: 'متأخر',      bg: '#ffedd5', fg: '#9a3412', dot: '#f97316' },
  frozen:    { label: 'مجمّد',      bg: '#e2e8f0', fg: '#475569', dot: '#64748b' },
  cancelled: { label: 'ملغى',       bg: '#fee2e2', fg: '#991b1b', dot: '#dc2626' },
};

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
};

const daysLeft = (iso?: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

// ============================================================================
// Component
// ============================================================================
const AdminDashboard: React.FC = () => {
  const { user, setViewAs } = useApp();
  const history = useHistory();
  const isAdmin = (user?.userType === 'admin') || ((user as any)?.user_type === 'admin');
  const [dbRole, setDbRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grantOpen, setGrantOpen] = useState(false);
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsorship | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  // ----- Reconcile JWT vs DB role -----
  useEffect(() => {
    if (!user?.id) return;
    userRepository.findById(user.id).then(p => p?.userType && setDbRole(p.userType)).catch(() => {});
  }, [user?.id]);

  const refreshRole = async () => {
    setRefreshing(true);
    try { await supabase.auth.refreshSession(); } catch {}
    window.location.reload();
  };

  // ----- Toast helper -----
  const showToast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  // ----- Data fetchers -----
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [usersRes, subsRes, sponsRes, settingsRes] = await Promise.all([
        supabase.from('users').select('id, name, shop, phone, address, email, created_at').eq('user_type', 'seller'),
        supabase.from('merchant_subscriptions').select('*'),
        supabase.from('sponsorships').select('*').order('priority', { ascending: false }),
        supabase.from('platform_settings').select('key, value'),
      ]);

      const subsByMerchant = new Map<string, Subscription>();
      (subsRes.data || []).forEach((s: any) => subsByMerchant.set(s.merchant_id, s));
      const merged: StoreRow[] = (usersRes.data || []).map((u: any) => ({
        ...u,
        subscription: subsByMerchant.get(u.id),
      }));
      setStores(merged);
      setSponsorships(sponsRes.data || []);
      const s: Record<string, any> = {};
      (settingsRes.data || []).forEach((row: any) => { s[row.key] = row.value; });
      setSettings(s);
    } catch (e) {
      console.error(e);
      showToast('فشل تحميل البيانات', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin || dbRole === 'admin') fetchAll();
  }, [isAdmin, dbRole]);

  // ----- Derived -----
  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter(s => {
      if (statusFilter !== 'all' && (s.subscription?.status || 'frozen') !== statusFilter) return false;
      if (!q) return true;
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.shop || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.email || '').toLowerCase().includes(q)
      );
    });
  }, [stores, search, statusFilter]);

  const stats = useMemo(() => {
    const total = stores.length;
    let trial = 0, active = 0, gifted = 0, frozen = 0, cancelled = 0;
    stores.forEach(s => {
      const st = s.subscription?.status;
      if (st === 'trial') trial++;
      else if (st === 'active') active++;
      else if (st === 'gifted') gifted++;
      else if (st === 'cancelled') cancelled++;
      else frozen++;
    });
    return { total, trial, active, gifted, frozen, cancelled };
  }, [stores]);

  // ----- Mutations -----
  const grantBulk = async (
    grantType: 'free' | 'discount',
    days: number,
    discount: number,
    reason: string
  ) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.rpc('grant_subscription_bulk', {
      p_merchant_ids: ids,
      p_grant_type: grantType,
      p_duration_days: days,
      p_discount_percent: discount,
      p_reason: reason || null,
    });
    if (error) {
      showToast(error.message || 'فشل المنح', 'err');
      return;
    }
    showToast(`تمت المنحة لـ ${ids.length} متجر`);
    setSelected(new Set());
    setGrantOpen(false);
    fetchAll();
  };

  const revoke = async (merchantId: string) => {
    if (!window.confirm('تأكيد إلغاء اشتراك هذا التاجر؟ سيُجمَّد فوراً.')) return;
    const { error } = await supabase.rpc('revoke_subscription', { p_merchant_id: merchantId });
    if (error) showToast(error.message, 'err');
    else { showToast('تم تجميد الاشتراك'); fetchAll(); }
  };

  const updateSetting = async (key: string, value: any) => {
    const { error } = await supabase
      .from('platform_settings')
      .update({ value: JSON.stringify(value), updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) showToast(error.message, 'err');
    else { setSettings(prev => ({ ...prev, [key]: value })); showToast('تم الحفظ'); }
  };

  const saveSponsorship = async (s: Partial<Sponsorship>) => {
    const payload = { ...s, updated_at: new Date().toISOString() };
    const { error } = s.id
      ? await supabase.from('sponsorships').update(payload).eq('id', s.id)
      : await supabase.from('sponsorships').insert([payload]);
    if (error) showToast(error.message, 'err');
    else { showToast('تم الحفظ'); setSponsorOpen(false); setEditingSponsor(null); fetchAll(); }
  };

  const toggleSponsor = async (id: string, isActive: boolean) => {
    const { error } = await supabase.from('sponsorships').update({ is_active: !isActive }).eq('id', id);
    if (error) showToast(error.message, 'err');
    else { setSponsorships(prev => prev.map(p => p.id === id ? { ...p, is_active: !isActive } : p)); }
  };

  const deleteSponsor = async (id: string) => {
    if (!window.confirm('حذف هذه الرعاية نهائياً؟')) return;
    const { error } = await supabase.from('sponsorships').delete().eq('id', id);
    if (error) showToast(error.message, 'err');
    else { setSponsorships(prev => prev.filter(p => p.id !== id)); showToast('تم الحذف'); }
  };

  // ============================================================================
  // Access guards
  // ============================================================================
  if (!isAdmin) {
    if (dbRole === 'admin') {
      return (
        <div style={styles.guardWrap} dir="rtl">
          <div style={styles.guardCard}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: 0, fontSize: 20 }}>تم ترقيتك إلى مدير</h2>
            <p style={{ color: '#64748b', fontSize: 14, marginTop: 8 }}>
              لكن الجلسة الحالية لم تتحدث. اضغط أدناه لتحديثها.
            </p>
            <button onClick={refreshRole} disabled={refreshing} style={styles.primaryBtn}>
              {refreshing ? '...جاري التحديث' : '🔄 تحديث الجلسة'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={styles.guardWrap} dir="rtl">
        <div style={styles.guardCard}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
          <h2 style={{ margin: 0, fontSize: 20 }}>غير مصرح</h2>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 8 }}>
            هذه الصفحة للمدراء فقط. (نوع حسابك: {user?.userType || 'غير معروف'})
          </p>
          <button onClick={refreshRole} disabled={refreshing} style={styles.primaryBtn}>
            {refreshing ? '...جاري' : '🔄 تحديث الجلسة'}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div style={styles.page} dir="rtl">
      <style>{KEYFRAMES}</style>

      {/* ───── Header ───── */}
      <div style={styles.header}>
        <div>
          <div style={styles.crumb}>لوحة التحكم</div>
          <h1 style={styles.title}>مركز الإدارة</h1>
        </div>
        <div style={styles.userBadge}>
          <div style={styles.avatar}>{(user?.name || 'A').charAt(0)}</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{user?.name || 'Admin'}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>مدير النظام</div>
          </div>
        </div>
      </div>

      {/* ───── Role switcher (top of admin page) ───── */}
      <div style={styles.viewAsCard}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>
          وضع المعاينة — اعرض التطبيق بعين المستخدم
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => { setViewAs('buyer'); history.push('/'); }} style={styles.viewAsBtn('buyer')}>
            <div style={{ fontSize: 22 }}>🛒</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>كمشتري</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>اعرض الصفحة الرئيسية والعروض</div>
            </div>
          </button>
          <button onClick={() => { setViewAs('seller'); history.push('/seller'); }} style={styles.viewAsBtn('seller')}>
            <div style={{ fontSize: 22 }}>🏪</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>كبائع</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>اعرض لوحة المتجر والعروض</div>
            </div>
          </button>
        </div>
      </div>

      {/* ───── Tabs ───── */}
      <div style={styles.tabsRow}>
        {([
          { id: 'overview',     label: '📊 نظرة عامة' },
          { id: 'stores',       label: '🏪 المتاجر والاشتراكات' },
          { id: 'sponsorships', label: '⭐ الرعايات' },
          { id: 'settings',     label: '⚙️ الإعدادات' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={styles.tabBtn(tab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ───── Body ───── */}
      <div style={{ animation: 'fadeIn .25s ease' }}>
        {loading ? (
          <SkeletonGrid />
        ) : tab === 'overview' ? (
          <OverviewTab stats={stats} sponsorships={sponsorships} />
        ) : tab === 'stores' ? (
          <StoresTab
            stores={filteredStores}
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            selected={selected}
            setSelected={setSelected}
            onGrant={() => setGrantOpen(true)}
            onRevoke={revoke}
          />
        ) : tab === 'sponsorships' ? (
          <SponsorshipsTab
            items={sponsorships}
            onAdd={() => { setEditingSponsor(null); setSponsorOpen(true); }}
            onEdit={(s) => { setEditingSponsor(s); setSponsorOpen(true); }}
            onToggle={toggleSponsor}
            onDelete={deleteSponsor}
          />
        ) : (
          <SettingsTab settings={settings} onUpdate={updateSetting} />
        )}
      </div>

      {/* ───── Modals ───── */}
      {grantOpen && (
        <GrantModal
          count={selected.size}
          onClose={() => setGrantOpen(false)}
          onSubmit={grantBulk}
        />
      )}
      {sponsorOpen && (
        <SponsorshipModal
          initial={editingSponsor}
          onClose={() => { setSponsorOpen(false); setEditingSponsor(null); }}
          onSubmit={saveSponsorship}
        />
      )}

      {/* ───── Toast ───── */}
      {toast && (
        <div style={styles.toast(toast.kind)}>
          {toast.kind === 'ok' ? '✓' : '⚠'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

// ============================================================================
// Sub-components
// ============================================================================
const Stat: React.FC<{ label: string; value: number | string; tone?: string; icon: string }> = ({ label, value, tone = '#0f172a', icon }) => (
  <div style={{ ...styles.statCard, animation: 'slideUp .3s ease' }}>
    <div style={{ ...styles.statIcon, background: `${tone}15`, color: tone }}>{icon}</div>
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: tone, marginTop: 2 }}>{value}</div>
    </div>
  </div>
);

const OverviewTab: React.FC<{ stats: any; sponsorships: Sponsorship[] }> = ({ stats, sponsorships }) => {
  const totalImpressions = sponsorships.reduce((s, x) => s + (x.impressions || 0), 0);
  const totalClicks = sponsorships.reduce((s, x) => s + (x.clicks || 0), 0);
  const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      <Stat label="إجمالي المتاجر"   value={stats.total}     icon="🏪" tone="#0f172a" />
      <Stat label="نشط"              value={stats.active}    icon="✅" tone="#16a34a" />
      <Stat label="تجريبي"           value={stats.trial}     icon="🎯" tone="#3b82f6" />
      <Stat label="هدية"             value={stats.gifted}    icon="🎁" tone="#f59e0b" />
      <Stat label="مجمّد"            value={stats.frozen}    icon="❄️" tone="#64748b" />
      <Stat label="ملغى"             value={stats.cancelled} icon="🛑" tone="#dc2626" />
      <Stat label="ظهور الرعايات"    value={totalImpressions.toLocaleString('ar-SA')} icon="👁️" tone="#0ea5e9" />
      <Stat label="نقرات الرعايات"   value={totalClicks.toLocaleString('ar-SA')}      icon="🖱️" tone="#8b5cf6" />
      <Stat label="معدّل النقر CTR"  value={`${ctr}%`}      icon="📈" tone="#10b981" />
    </div>
  );
};

const StoresTab: React.FC<{
  stores: StoreRow[];
  search: string;
  setSearch: (s: string) => void;
  statusFilter: SubStatus | 'all';
  setStatusFilter: (s: SubStatus | 'all') => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onGrant: () => void;
  onRevoke: (id: string) => void;
}> = ({ stores, search, setSearch, statusFilter, setStatusFilter, selected, setSelected, onGrant, onRevoke }) => {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const allSelected = stores.length > 0 && stores.every(s => selected.has(s.id));

  return (
    <div>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', right: 12, top: 11, color: '#94a3b8' }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم، المتجر، الجوال أو البريد..."
            style={styles.input}
          />
        </div>

        <div style={styles.filterChips}>
          {(['all', 'trial', 'active', 'gifted', 'frozen', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s as any)} style={styles.chip(statusFilter === s)}>
              {s === 'all' ? 'الكل' : STATUS_META[s as SubStatus].label}
            </button>
          ))}
        </div>

        <button
          disabled={selected.size === 0}
          onClick={onGrant}
          style={{ ...styles.primaryBtn, opacity: selected.size === 0 ? 0.4 : 1, cursor: selected.size === 0 ? 'not-allowed' : 'pointer' }}>
          🎁 منح ({selected.size})
        </button>
      </div>

      {/* Table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 36 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(stores.map(s => s.id)))}
                />
              </th>
              <th style={styles.th}>المتجر</th>
              <th style={styles.th}>الحالة</th>
              <th style={styles.th}>الباقة</th>
              <th style={styles.th}>تنتهي</th>
              <th style={styles.th}>الفروع</th>
              <th style={styles.th}>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {stores.length === 0 && (
              <tr><td colSpan={7} style={styles.empty}>لا توجد نتائج</td></tr>
            )}
            {stores.map(s => {
              const sub = s.subscription;
              const status: SubStatus = sub?.status || 'frozen';
              const meta = STATUS_META[status];
              const expiry = sub?.current_period_end || sub?.trial_ends_at;
              const dl = daysLeft(expiry);
              return (
                <tr key={s.id} style={styles.row(selected.has(s.id))}>
                  <td style={styles.td}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 800 }}>{s.shop || s.name || '—'}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }} dir="ltr">{s.phone || s.email || ''}</div>
                  </td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: meta.bg, color: meta.fg }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: meta.dot, display: 'inline-block' }} />
                      {meta.label}
                    </span>
                    {sub?.cancel_at_period_end && (
                      <span style={{ ...styles.badge, background: '#fef2f2', color: '#991b1b', marginRight: 6 }}>
                        إلغاء عند الانتهاء
                      </span>
                    )}
                  </td>
                  <td style={styles.td}>
                    {sub?.discount_percent
                      ? <span style={{ color: '#16a34a', fontWeight: 800 }}>-{sub.discount_percent}%</span>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={styles.td}>
                    <div style={{ fontSize: 13 }}>{fmtDate(expiry)}</div>
                    {dl !== null && dl >= 0 && (
                      <div style={{ fontSize: 11, color: dl <= 3 ? '#dc2626' : '#64748b' }}>
                        خلال {dl} يوم
                      </div>
                    )}
                  </td>
                  <td style={styles.td}>{sub?.branches_count ?? 1}</td>
                  <td style={styles.td}>
                    {sub && status !== 'frozen' && status !== 'cancelled' ? (
                      <button onClick={() => onRevoke(s.id)} style={styles.dangerBtn}>تجميد</button>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SponsorshipsTab: React.FC<{
  items: Sponsorship[];
  onAdd: () => void;
  onEdit: (s: Sponsorship) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}> = ({ items, onAdd, onEdit, onToggle, onDelete }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: '#64748b' }}>{items.length} رعاية إعلانية</div>
      <button onClick={onAdd} style={styles.primaryBtn}>+ رعاية جديدة</button>
    </div>

    {items.length === 0 ? (
      <div style={{ ...styles.empty, padding: 60, background: 'white', borderRadius: 16 }}>
        لا توجد رعايات بعد. ابدأ بإضافة واحدة.
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {items.map(s => {
          const ctr = s.impressions > 0 ? ((s.clicks / s.impressions) * 100).toFixed(1) : '0';
          return (
            <div key={s.id} style={{ ...styles.sponsorCard, opacity: s.is_active ? 1 : 0.5 }}>
              {s.image_url
                ? <img src={s.image_url} alt="" style={styles.sponsorImg} />
                : <div style={{ ...styles.sponsorImg, ...styles.sponsorImgFallback }}>🖼️</div>}
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}>
                    {s.title_ar || s.title_en || '(بدون عنوان)'}
                  </div>
                  <span style={styles.typeBadge}>{s.type}</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, minHeight: 32 }}>
                  {s.body_ar?.slice(0, 80) || ''}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b', marginTop: 10 }}>
                  <span>👁️ {s.impressions.toLocaleString('ar-SA')}</span>
                  <span>🖱️ {s.clicks.toLocaleString('ar-SA')}</span>
                  <span>📈 {ctr}%</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button onClick={() => onToggle(s.id, s.is_active)} style={styles.smallBtn(s.is_active ? '#fef3c7' : '#dcfce7', s.is_active ? '#92400e' : '#166534')}>
                    {s.is_active ? '⏸️ إيقاف' : '▶️ تفعيل'}
                  </button>
                  <button onClick={() => onEdit(s)} style={styles.smallBtn('#e2e8f0', '#0f172a')}>تعديل</button>
                  <button onClick={() => onDelete(s.id)} style={styles.smallBtn('#fee2e2', '#991b1b')}>حذف</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const SettingsTab: React.FC<{
  settings: Record<string, any>;
  onUpdate: (key: string, value: any) => void;
}> = ({ settings, onUpdate }) => {
  const paymentEnabled = settings.payment_gateway_enabled === true || settings.payment_gateway_enabled === 'true';
  const trialDays = Number(settings.trial_days || 14);
  const basicPrice = Number(settings.basic_plan_price_sar || 99);
  const extraBranchFee = Number(settings.extra_branch_fee_sar || 25);

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
      <SettingRow
        title="بوابة الدفع (SaaS)"
        desc={paymentEnabled ? 'مفعّلة — التطبيق مدفوع' : 'معطّلة — التطبيق مجاني للجميع'}
        right={
          <button onClick={() => onUpdate('payment_gateway_enabled', !paymentEnabled)} style={styles.toggle(paymentEnabled)}>
            <span style={styles.toggleKnob(paymentEnabled)} />
          </button>
        }
      />
      <SettingRow
        title="مدة الفترة التجريبية (أيام)"
        desc="يبدأ التاجر الجديد بفترة تجريبية مجانية بهذا الطول"
        right={
          <NumberSetting initial={trialDays} suffix="يوم" onSave={(v) => onUpdate('trial_days', v)} />
        }
      />
      <SettingRow
        title="سعر الباقة الأساسية"
        desc="السعر الشهري الافتراضي بالريال السعودي"
        right={
          <NumberSetting initial={basicPrice} suffix="ر.س" onSave={(v) => onUpdate('basic_plan_price_sar', v)} />
        }
      />
      <SettingRow
        title="رسوم الفرع الإضافي"
        desc="بعد تجاوز الفروع المشمولة في الباقة"
        right={
          <NumberSetting initial={extraBranchFee} suffix="ر.س" onSave={(v) => onUpdate('extra_branch_fee_sar', v)} />
        }
      />
    </div>
  );
};

const SettingRow: React.FC<{ title: string; desc: string; right: React.ReactNode }> = ({ title, desc, right }) => (
  <div style={styles.settingRow}>
    <div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{desc}</div>
    </div>
    {right}
  </div>
);

const NumberSetting: React.FC<{ initial: number; suffix: string; onSave: (v: number) => void }> = ({ initial, suffix, onSave }) => {
  const [val, setVal] = useState(initial);
  const dirty = val !== initial;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        style={{ ...styles.input, width: 90, padding: 8, textAlign: 'center' }}
      />
      <span style={{ fontSize: 12, color: '#64748b' }}>{suffix}</span>
      {dirty && (
        <button onClick={() => onSave(val)} style={{ ...styles.smallBtn('#16a34a', 'white'), fontWeight: 800 }}>حفظ</button>
      )}
    </div>
  );
};

// ============================================================================
// Modals
// ============================================================================
const GrantModal: React.FC<{ count: number; onClose: () => void; onSubmit: (type: 'free' | 'discount', days: number, discount: number, reason: string) => void }> = ({ count, onClose, onSubmit }) => {
  const [type, setType] = useState<'free' | 'discount'>('discount');
  const [discount, setDiscount] = useState(50);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState('');

  return (
    <Modal onClose={onClose} title={`منح اشتراك (${count} متجر)`}>
      {/* Type */}
      <div style={styles.modalLabel}>نوع المنحة</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button onClick={() => setType('discount')} style={styles.pickerBtn(type === 'discount')}>
          <div style={{ fontSize: 22 }}>🏷️</div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>خصم</div>
        </button>
        <button onClick={() => setType('free')} style={styles.pickerBtn(type === 'free')}>
          <div style={{ fontSize: 22 }}>🎁</div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>مجاني كامل</div>
        </button>
      </div>

      {type === 'discount' && (
        <>
          <div style={{ ...styles.modalLabel, marginTop: 14 }}>نسبة الخصم: {discount}%</div>
          <input type="range" min={5} max={100} step={5} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: '100%' }} />
        </>
      )}

      <div style={{ ...styles.modalLabel, marginTop: 14 }}>المدة (أيام)</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[7, 30, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} style={styles.chip(days === d)}>{d}</button>
        ))}
        <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...styles.input, width: 90 }} />
      </div>

      <div style={{ ...styles.modalLabel, marginTop: 14 }}>السبب (اختياري)</div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="حملة ترويجية، شراكة، تعويض..." style={styles.input} />

      <div style={styles.modalActions}>
        <button onClick={onClose} style={styles.ghostBtn}>إلغاء</button>
        <button onClick={() => onSubmit(type, days, discount, reason)} style={styles.primaryBtn}>تأكيد المنحة</button>
      </div>
    </Modal>
  );
};

const SponsorshipModal: React.FC<{ initial: Sponsorship | null; onClose: () => void; onSubmit: (s: Partial<Sponsorship>) => void }> = ({ initial, onClose, onSubmit }) => {
  const [form, setForm] = useState<Partial<Sponsorship>>(initial || {
    type: 'top_slider',
    title_ar: '',
    title_en: '',
    body_ar: '',
    image_url: '',
    action_url: '',
    is_active: true,
    priority: 0,
  });
  const set = <K extends keyof Sponsorship>(k: K, v: any) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Modal onClose={onClose} title={initial ? 'تعديل رعاية' : 'رعاية جديدة'}>
      <div style={styles.modalLabel}>النوع</div>
      <select value={form.type} onChange={(e) => set('type', e.target.value)} style={styles.input}>
        <option value="top_slider">سلايدر علوي</option>
        <option value="inline_banner">بانر داخل القائمة</option>
        <option value="sponsored_deal">عرض مدعوم</option>
        <option value="native_ad">إعلان نصي</option>
        <option value="verified_badge">شارة موثّقة</option>
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div>
          <div style={styles.modalLabel}>العنوان (عربي)</div>
          <input value={form.title_ar || ''} onChange={(e) => set('title_ar', e.target.value)} style={styles.input} />
        </div>
        <div>
          <div style={styles.modalLabel}>العنوان (إنجليزي)</div>
          <input value={form.title_en || ''} onChange={(e) => set('title_en', e.target.value)} style={styles.input} />
        </div>
      </div>

      <div style={{ ...styles.modalLabel, marginTop: 12 }}>الوصف</div>
      <textarea value={form.body_ar || ''} onChange={(e) => set('body_ar', e.target.value)} rows={2} style={{ ...styles.input, resize: 'vertical' }} />

      <div style={{ ...styles.modalLabel, marginTop: 12 }}>رابط الصورة</div>
      <input value={form.image_url || ''} onChange={(e) => set('image_url', e.target.value)} placeholder="https://..." style={styles.input} />

      <div style={{ ...styles.modalLabel, marginTop: 12 }}>رابط الإجراء (CTA)</div>
      <input value={form.action_url || ''} onChange={(e) => set('action_url', e.target.value)} placeholder="/deals/123 أو https://..." style={styles.input} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div>
          <div style={styles.modalLabel}>الأولوية</div>
          <input type="number" value={form.priority ?? 0} onChange={(e) => set('priority', Number(e.target.value))} style={styles.input} />
        </div>
        <div>
          <div style={styles.modalLabel}>الحالة</div>
          <button onClick={() => set('is_active', !form.is_active)} style={{ ...styles.input, textAlign: 'center', cursor: 'pointer', background: form.is_active ? '#dcfce7' : '#fee2e2', color: form.is_active ? '#166534' : '#991b1b', fontWeight: 800 }}>
            {form.is_active ? '✓ مفعّلة' : '⏸ موقوفة'}
          </button>
        </div>
      </div>

      <div style={styles.modalActions}>
        <button onClick={onClose} style={styles.ghostBtn}>إلغاء</button>
        <button onClick={() => onSubmit(form)} style={styles.primaryBtn}>حفظ</button>
      </div>
    </Modal>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div style={styles.overlay} onClick={onClose}>
    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
      <div style={styles.modalHeader}>
        <div style={{ fontWeight: 900, fontSize: 17 }}>{title}</div>
        <button onClick={onClose} style={styles.closeBtn}>✕</button>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  </div>
);

const SkeletonGrid: React.FC = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} style={{ ...styles.statCard, height: 96, animation: 'pulse 1.4s ease-in-out infinite' }} />
    ))}
  </div>
);

// ============================================================================
// Styles (inline — keeps the page self-contained, dark-mode-friendly)
// ============================================================================
const KEYFRAMES = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.8; } }
@keyframes slideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
.admin-row:hover { background: #f8fafc !important; }
`;

const styles: any = {
  page: {
    maxWidth: 1240, margin: '0 auto', padding: '20px 16px 100px',
    fontFamily: 'Tajawal, system-ui, sans-serif',
    color: '#0f172a',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20, flexWrap: 'wrap', gap: 12,
  },
  crumb: { fontSize: 12, color: '#64748b', fontWeight: 600 },
  title: { fontSize: 28, fontWeight: 900, margin: 0, marginTop: 4 },
  userBadge: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'white', padding: '8px 14px', borderRadius: 12,
    border: '1px solid #e2e8f0',
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, background: '#0f172a', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
  },
  viewAsCard: {
    background: 'white', borderRadius: 16, padding: 16, marginBottom: 18,
    border: '1px solid #e2e8f0', animation: 'slideDown .3s ease',
  },
  viewAsBtn: (kind: string) => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
    background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 12,
    cursor: 'pointer', textAlign: 'right' as const, transition: 'all .2s',
    color: '#0f172a',
  }),
  tabsRow: {
    display: 'flex', gap: 6, marginBottom: 18, overflowX: 'auto' as const,
    background: 'white', padding: 6, borderRadius: 14, border: '1px solid #e2e8f0',
  },
  tabBtn: (active: boolean) => ({
    flexShrink: 0, padding: '10px 18px', borderRadius: 10, border: 'none',
    background: active ? '#0f172a' : 'transparent',
    color: active ? 'white' : '#64748b',
    fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
    transition: 'all .2s',
  }),
  statCard: {
    background: 'white', borderRadius: 14, padding: 16,
    border: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center', gap: 14,
    transition: 'transform .2s, box-shadow .2s',
  },
  statIcon: {
    width: 44, height: 44, borderRadius: 12, fontSize: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  toolbar: {
    display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center',
  },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1.5px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
    outline: 'none', background: 'white', color: '#0f172a',
    transition: 'border-color .15s',
  },
  filterChips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: (active: boolean) => ({
    padding: '8px 14px', borderRadius: 99, border: '1.5px solid',
    borderColor: active ? '#0f172a' : '#e2e8f0',
    background: active ? '#0f172a' : 'white',
    color: active ? 'white' : '#475569',
    fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    transition: 'all .15s',
  }),
  primaryBtn: {
    padding: '10px 18px', borderRadius: 10, border: 'none',
    background: '#0f172a', color: 'white', fontWeight: 800, fontSize: 13.5,
    cursor: 'pointer', transition: 'transform .1s, opacity .15s',
  },
  ghostBtn: {
    padding: '10px 18px', borderRadius: 10,
    border: '1.5px solid #e2e8f0', background: 'white',
    color: '#475569', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
  },
  dangerBtn: {
    padding: '6px 12px', borderRadius: 8, border: 'none',
    background: '#fee2e2', color: '#991b1b', fontWeight: 800, fontSize: 12,
    cursor: 'pointer',
  },
  smallBtn: (bg: string, fg: string) => ({
    padding: '6px 12px', borderRadius: 8, border: 'none',
    background: bg, color: fg, fontWeight: 700, fontSize: 12, cursor: 'pointer',
    flex: 1,
  }),
  tableWrap: {
    background: 'white', borderRadius: 14, overflow: 'hidden',
    border: '1px solid #e2e8f0',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13.5 },
  th: {
    textAlign: 'right' as const, padding: '14px 12px',
    background: '#f8fafc', color: '#475569', fontWeight: 800, fontSize: 12,
    borderBottom: '1px solid #e2e8f0',
  },
  td: {
    padding: '14px 12px', borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'top' as const,
  },
  row: (selected: boolean) => ({
    background: selected ? '#f0f9ff' : 'white',
    transition: 'background .15s',
  }),
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 800,
  },
  empty: { textAlign: 'center' as const, padding: 50, color: '#94a3b8', fontSize: 14 },
  sponsorCard: {
    background: 'white', borderRadius: 14, overflow: 'hidden',
    border: '1px solid #e2e8f0', transition: 'transform .2s, box-shadow .2s',
  },
  sponsorImg: { width: '100%', height: 140, objectFit: 'cover' as const, background: '#f1f5f9' },
  sponsorImgFallback: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, color: '#cbd5e1' },
  typeBadge: {
    fontSize: 10, padding: '3px 8px', borderRadius: 6,
    background: '#f1f5f9', color: '#475569', fontWeight: 800,
    whiteSpace: 'nowrap' as const,
  },
  settingRow: {
    background: 'white', padding: 18, borderRadius: 14,
    border: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 14, flexWrap: 'wrap' as const,
  },
  toggle: (on: boolean) => ({
    width: 50, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
    background: on ? '#16a34a' : '#cbd5e1',
    position: 'relative' as const, transition: 'background .2s',
  }),
  toggleKnob: (on: boolean) => ({
    position: 'absolute' as const, top: 3, [on ? 'left' : 'right']: 3,
    width: 22, height: 22, borderRadius: 11, background: 'white',
    transition: 'all .2s',
  }),
  pickerBtn: (active: boolean) => ({
    padding: 14, borderRadius: 12, cursor: 'pointer',
    border: '2px solid', borderColor: active ? '#0f172a' : '#e2e8f0',
    background: active ? '#f8fafc' : 'white',
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6,
    transition: 'all .15s',
  }),
  modalLabel: { fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6, marginTop: 0 },
  modalActions: { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  overlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(15, 23, 42, 0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16, animation: 'fadeIn .2s ease',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'white', borderRadius: 18, width: '100%', maxWidth: 520,
    maxHeight: '90vh', overflowY: 'auto' as const,
    animation: 'slideUp .25s ease',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
  },
  closeBtn: {
    background: '#f1f5f9', border: 'none', width: 32, height: 32,
    borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#475569',
  },
  toast: (kind: 'ok' | 'err') => ({
    position: 'fixed' as const, bottom: 24, right: 24,
    background: kind === 'ok' ? '#16a34a' : '#dc2626',
    color: 'white', padding: '12px 20px', borderRadius: 12,
    fontWeight: 800, fontSize: 14, zIndex: 1100,
    boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
    animation: 'slideUp .3s ease',
  }),
  guardWrap: {
    minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, fontFamily: 'Tajawal, system-ui, sans-serif',
  },
  guardCard: {
    background: 'white', padding: 32, borderRadius: 18, textAlign: 'center' as const,
    maxWidth: 360, border: '1px solid #e2e8f0',
  },
};
