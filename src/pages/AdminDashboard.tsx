import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import {
  OverviewStats, TimeseriesPoint, CityRow, TopStoreRow,
  AdminStoreRow, AdminUserRow, AdminDealRow, AdminBanner,
  getOverviewStats, getTimeseries, getCityBreakdown, getTopStores,
  getAllStores, getAllUsers, getAllDeals, getAllBanners,
  startHeartbeat, stopHeartbeat,
  suspendUser, unsuspendUser, adminDeleteDeal, logActivity
} from '../services/adminService';
import {
  KPICard, AreaChart, Donut, BarList, SectionCard,
  TabPill, EmptyState, Sparkline
} from '../components/admin/AdminUI';
import LiveActivityFeed from '../components/admin/LiveActivityFeed';
import StoreActionsModal from '../components/admin/StoreActionsModal';

type TabId = 'overview' | 'stores' | 'products' | 'users' | 'banners' | 'live' | 'settings';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'overview', icon: '📊', label: 'النظرة العامة' },
  { id: 'stores',   icon: '🏪', label: 'المتاجر' },
  { id: 'products', icon: '📦', label: 'العروض' },
  { id: 'users',    icon: '👥', label: 'المستخدمون' },
  { id: 'banners',  icon: '🖼️', label: 'البانرات' },
  { id: 'live',     icon: '⚡', label: 'النشاط الحي' },
  { id: 'settings', icon: '⚙️', label: 'الإعدادات' },
];

const AdminDashboard: React.FC = () => {
  const { user, customAlert, customConfirm, language } = useApp();
  const [tab, setTab] = useState<TabId>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => { startHeartbeat(); return () => stopHeartbeat(); }, []);

  const isAdmin = user?.userType === 'admin' || user?.user_type === 'admin';
  if (!isAdmin) {
    return (
      <div dir="rtl" style={{ padding: 32, textAlign: 'center', fontFamily: 'Tajawal, sans-serif' }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#ef4444' }}>غير مصرح بالدخول</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>هذه الصفحة مخصصة للمشرفين فقط.</div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{
      minHeight: '100vh', background: 'var(--bg, #f8fafc)',
      fontFamily: 'Tajawal, sans-serif', paddingBottom: 40
    }}>
      {/* Top Bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-color, #f1f5f9)',
        padding: '14px 18px'
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 18, fontWeight: 900
            }}>🛠️</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary, #0f172a)' }}>مركز تحكم المشرف</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
                مرحباً {user?.name} • {new Date().toLocaleDateString('ar-SA')}
              </div>
            </div>
          </div>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <TabPill key={t.id} active={tab === t.id} icon={t.icon} label={t.label} onClick={() => setTab(t.id)} />
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 18px' }}>
        {tab === 'overview' && <OverviewTab key={refreshKey} />}
        {tab === 'stores'   && <StoresTab key={refreshKey} onChanged={refresh} />}
        {tab === 'products' && <ProductsTab key={refreshKey} onChanged={refresh} customConfirm={customConfirm} customAlert={customAlert} />}
        {tab === 'users'    && <UsersTab key={refreshKey} onChanged={refresh} customConfirm={customConfirm} customAlert={customAlert} />}
        {tab === 'banners'  && <BannersTab key={refreshKey} onChanged={refresh} customAlert={customAlert} customConfirm={customConfirm} />}
        {tab === 'live'     && <LiveTab />}
        {tab === 'settings' && <SettingsTab customAlert={customAlert} />}
      </div>
    </div>
  );
};

// ============================================================
// OVERVIEW TAB
// ============================================================
const OverviewTab: React.FC = () => {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [topStores, setTopStores] = useState<TopStoreRow[]>([]);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      getOverviewStats(),
      getTimeseries(days),
      getCityBreakdown(),
      getTopStores(8),
    ]).then(([s, ts, c, tops]) => {
      if (!alive) return;
      setStats(s); setSeries(ts); setCities(c); setTopStores(tops);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [days]);

  const labels = useMemo(() =>
    series.map(p => new Date(p.day).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })), [series]);

  const t = stats?.totals;
  const today = stats?.today;
  const yesterday = stats?.yesterday;

  // Delta vs yesterday
  const userDelta = today && yesterday && yesterday.new_users > 0
    ? ((today.new_users - yesterday.new_users) / yesterday.new_users) * 100 : 0;
  const bookingDelta = today && yesterday && yesterday.new_bookings > 0
    ? ((today.new_bookings - yesterday.new_bookings) / yesterday.new_bookings) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero "Live Pulse" strip */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        borderRadius: 18, padding: 20, color: '#fff',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16,
        position: 'relative', overflow: 'hidden'
      }}>
        <div style={{ position: 'absolute', top: -40, insetInlineEnd: -40, width: 200, height: 200, background: 'radial-gradient(circle, rgba(16,185,129,0.3), transparent)', borderRadius: '50%' }} />
        <PulseStat icon="🟢" label="نشطون الآن" value={t?.active_now ?? 0} hint="آخر 5 دقائق" pulse />
        <PulseStat icon="📅" label="نشطون اليوم" value={t?.active_today ?? 0} hint={`من أصل ${t?.users ?? 0}`} />
        <PulseStat icon="🛒" label="حجوزات اليوم" value={today?.new_bookings ?? 0} hint={`الإجمالي ${t?.bookings_total ?? 0}`} />
        <PulseStat icon="✨" label="تسجيلات اليوم" value={today?.new_users ?? 0} hint={`+${today?.new_sellers ?? 0} تاجر`} />
        <PulseStat icon="⏳" label="حجوزات معلقة" value={t?.bookings_pending ?? 0} hint="بانتظار التاجر" />
      </div>

      {/* Primary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <KPICard label="إجمالي المستخدمين" value={t?.users.toLocaleString('ar-SA') ?? 0} icon="👥" accent="#3b82f6"
                 hint={`${t?.buyers ?? 0} مشتري + ${t?.sellers ?? 0} تاجر`}
                 delta={userDelta} loading={loading} />
        <KPICard label="حجوزات إجمالية" value={t?.bookings_total.toLocaleString('ar-SA') ?? 0} icon="🎟️" accent="#10b981"
                 hint={`${t?.bookings_completed ?? 0} مكتمل`}
                 delta={bookingDelta} loading={loading} />
        <KPICard label="عروض نشطة" value={t?.deals_active.toLocaleString('ar-SA') ?? 0} icon="🛍️" accent="#8b5cf6"
                 hint={`${t?.deals_total ?? 0} إجمالي`} loading={loading} />
        <KPICard label="مشاهدات إجمالية" value={(t?.total_views ?? 0).toLocaleString('ar-SA')} icon="👁️" accent="#06b6d4"
                 hint={`${t?.total_clicks ?? 0} نقرة`} loading={loading} />
        <KPICard label="اشتراكات نشطة" value={t?.subs_active ?? 0} icon="⭐" accent="#f59e0b"
                 hint={`${t?.subs_premium ?? 0} ممتاز • ${t?.subs_expired ?? 0} منتهي`} loading={loading} />
        <KPICard label="متوسط التقييم" value={t?.avg_rating || '—'} icon="🌟" accent="#ec4899"
                 hint={`${t?.ratings_count ?? 0} تقييم`} loading={loading} />
      </div>

      {/* Time-series chart */}
      <SectionCard
        title="نمو المنصة على مدار الزمن"
        subtitle="تسجيلات • عروض • حجوزات • مستخدمون نشطون"
        action={
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
            {([7, 30, 90] as const).map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '4px 10px', borderRadius: 8, border: 'none',
                background: days === d ? '#fff' : 'transparent',
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                color: days === d ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}>{d} يوم</button>
            ))}
          </div>
        }
      >
        {labels.length > 0 ? (
          <AreaChart
            labels={labels}
            series={[
              { label: 'مستخدمون نشطون', data: series.map(s => s.active_users), color: '#10b981' },
              { label: 'حجوزات',          data: series.map(s => s.new_bookings), color: '#3b82f6' },
              { label: 'تسجيلات',         data: series.map(s => s.new_users),    color: '#8b5cf6' },
              { label: 'عروض جديدة',      data: series.map(s => s.new_deals),    color: '#f59e0b' },
            ]}
            height={260}
          />
        ) : (
          <EmptyState icon="📈" title="لا توجد بيانات للفترة المحددة" />
        )}
      </SectionCard>

      {/* Two-column: Donut + Top stores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <SectionCard title="توزيع المستخدمين" subtitle="حسب النوع">
          {t && (
            <Donut
              centerLabel="مستخدم"
              centerValue={t.users}
              segments={[
                { label: 'مشترون', value: t.buyers,  color: '#3b82f6' },
                { label: 'تجار',    value: t.sellers, color: '#10b981' },
                { label: 'موقوف',  value: t.suspended, color: '#ef4444' },
              ]}
            />
          )}
        </SectionCard>
        <SectionCard title="حالة الحجوزات">
          {t && (
            <Donut
              centerLabel="حجز"
              centerValue={t.bookings_total}
              segments={[
                { label: 'مكتمل', value: t.bookings_completed, color: '#10b981' },
                { label: 'معلق',  value: t.bookings_pending,   color: '#f59e0b' },
                { label: 'أخرى',  value: Math.max(0, t.bookings_total - t.bookings_completed - t.bookings_pending), color: '#94a3b8' },
              ]}
            />
          )}
        </SectionCard>
        <SectionCard title="الاشتراكات" subtitle="الباقات الحالية">
          {t && (
            <Donut
              centerLabel="تاجر"
              centerValue={t.sellers}
              segments={[
                { label: 'ممتاز',  value: t.subs_premium, color: '#f59e0b' },
                { label: 'نشط',    value: Math.max(0, t.subs_active - t.subs_premium), color: '#10b981' },
                { label: 'منتهي',  value: t.subs_expired, color: '#ef4444' },
              ]}
            />
          )}
        </SectionCard>
      </div>

      {/* Top stores + Cities */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
        <SectionCard title="🏆 أفضل المتاجر أداءً" subtitle="مرتبة حسب المشاهدات">
          {topStores.length === 0 ? <EmptyState icon="🏪" title="لا توجد بيانات" /> : (
            <BarList
              color="#10b981"
              rows={topStores.map(s => ({
                label: s.shop || '—',
                value: s.total_views,
                sub: `${s.deal_count} عرض • ${s.total_bookings} حجز • ${s.avg_rating || 0}⭐`
              }))}
              formatValue={n => `${n.toLocaleString('ar-SA')} 👁️`}
            />
          )}
        </SectionCard>
        <SectionCard title="🗺️ التوزيع الجغرافي" subtitle="المستخدمون حسب المدينة">
          {cities.length === 0 ? <EmptyState icon="🌍" title="لا توجد بيانات" /> : (
            <BarList
              color="#3b82f6"
              rows={cities.slice(0, 8).map(c => ({
                label: c.city,
                value: c.users,
                sub: `${c.sellers} تاجر • ${c.buyers} مشتري`
              }))}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
};

const PulseStat: React.FC<{ icon: string; label: string; value: number | string; hint?: string; pulse?: boolean }> = ({ icon, label, value, hint, pulse }) => (
  <div style={{ position: 'relative' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.85, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
      {pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', animation: 'taki-pulse2 1.6s ease-in-out infinite' }} />}
    </div>
    <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{typeof value === 'number' ? value.toLocaleString('ar-SA') : value}</div>
    {hint && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, fontWeight: 600 }}>{hint}</div>}
    <style>{`@keyframes taki-pulse2 { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(1.6); } }`}</style>
  </div>
);

// ============================================================
// STORES TAB
// ============================================================
const StoresTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [stores, setStores] = useState<AdminStoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'suspended'>('all');
  const [selected, setSelected] = useState<AdminStoreRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [grantOpen, setGrantOpen] = useState(false);
  const { customAlert } = useApp();

  const reload = () => {
    setLoading(true);
    getAllStores().then(d => { setStores(d); setLoading(false); });
  };
  useEffect(reload, []);

  const filtered = useMemo(() => {
    return stores.filter(s => {
      if (filter === 'suspended' && s.is_active !== false) return false;
      if (filter === 'active') {
        const exp = s.store_profiles?.subscription_expires_at;
        if (!exp || new Date(exp) < new Date()) return false;
      }
      if (filter === 'expired') {
        const exp = s.store_profiles?.subscription_expires_at;
        if (exp && new Date(exp) >= new Date()) return false;
      }
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return (s.shop || '').toLowerCase().includes(q)
          || (s.name || '').toLowerCase().includes(q)
          || (s.address || '').toLowerCase().includes(q)
          || (s.phone || '').includes(q);
    });
  }, [stores, search, filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Toolbar */}
      <div style={{
        background: 'var(--card-bg, #fff)', borderRadius: 14, padding: 12,
        border: '1px solid var(--border-color, #f1f5f9)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'
      }}>
        <input placeholder="🔍 ابحث باسم المتجر، الجوال، أو المدينة..." value={search} onChange={e => setSearch(e.target.value)}
               style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 13, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
          {([['all','الكل'],['active','نشط'],['expired','منتهي'],['suspended','معلّق']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v as any)} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              background: filter === v ? '#fff' : 'transparent',
              fontSize: 12, fontWeight: 800, cursor: 'pointer',
              color: filter === v ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setGrantOpen(true)} disabled={picked.size === 0} style={{
          padding: '9px 16px', borderRadius: 10, background: picked.size === 0 ? '#94a3b8' : '#10b981',
          color: '#fff', border: 'none', fontWeight: 800, fontSize: 12,
          cursor: picked.size === 0 ? 'not-allowed' : 'pointer', opacity: picked.size === 0 ? 0.6 : 1
        }}>🎁 منح ({picked.size})</button>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color, #f1f5f9)' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🏪" title="لا توجد متاجر مطابقة" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f8fafc)', textAlign: 'right' }}>
                <th style={tableHead}><input type="checkbox" checked={picked.size === filtered.length && filtered.length > 0}
                       onChange={e => setPicked(e.target.checked ? new Set(filtered.map(s => s.id)) : new Set())} /></th>
                <th style={tableHead}>المتجر</th>
                <th style={tableHead}>المدينة</th>
                <th style={tableHead}>الباقة</th>
                <th style={tableHead}>الانتهاء</th>
                <th style={tableHead}>الحالة</th>
                <th style={tableHead}>آخر دخول</th>
                <th style={tableHead}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const sp = s.store_profiles;
                const exp = sp?.subscription_expires_at ? new Date(sp.subscription_expires_at) : null;
                const isExpired = exp ? exp < new Date() : true;
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border-color, #f1f5f9)' }}>
                    <td style={tableCell}>
                      <input type="checkbox" checked={picked.has(s.id)} onChange={() => {
                        const next = new Set(picked);
                        next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                        setPicked(next);
                      }} />
                    </td>
                    <td style={tableCell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.avatar_url ? (
                          <img src={s.avatar_url} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#10b98115', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🏪</div>
                        )}
                        <div>
                          <div style={{ fontWeight: 800 }}>{s.shop || s.name}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }} dir="ltr">{s.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tableCell}>{s.address || '—'}</td>
                    <td style={tableCell}>
                      <PlanBadge plan={sp?.subscription_plan} />
                      {sp?.discount_percentage ? <span style={{ marginInlineStart: 4, fontSize: 10, color: '#10b981', fontWeight: 800 }}>{sp.discount_percentage}%</span> : null}
                    </td>
                    <td style={tableCell}>
                      {exp ? (
                        <span style={{ color: isExpired ? '#ef4444' : 'var(--text-primary)', fontWeight: 700 }}>
                          {exp.toLocaleDateString('ar-SA')}
                        </span>
                      ) : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td style={tableCell}>
                      {s.is_active === false ? (
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: '#fee2e2', color: '#991b1b' }}>معلّق</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>نشط</span>
                      )}
                    </td>
                    <td style={tableCell}>{s.last_seen_at ? new Date(s.last_seen_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    <td style={tableCell}>
                      <button onClick={() => setSelected(s)} style={{
                        padding: '6px 12px', borderRadius: 8, background: '#10b981', color: '#fff',
                        border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer'
                      }}>إدارة</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <StoreActionsModal store={selected} onClose={() => setSelected(null)} onChanged={() => { reload(); onChanged(); }} />
      )}
      {grantOpen && (
        <GrantModal storeIds={Array.from(picked)} onClose={() => setGrantOpen(false)}
                    onDone={() => { setGrantOpen(false); setPicked(new Set()); reload(); onChanged(); customAlert('تم تطبيق المنحة'); }} />
      )}
    </div>
  );
};

const PlanBadge: React.FC<{ plan: string | null | undefined }> = ({ plan }) => {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    premium: { color: '#854d0e', bg: '#fef3c7', label: '⭐ ممتاز' },
    trial:   { color: '#1e40af', bg: '#dbeafe', label: 'تجريبي' },
    basic:   { color: '#166534', bg: '#dcfce7', label: 'أساسي' },
    free:    { color: '#475569', bg: '#e2e8f0', label: 'مجاني' },
  };
  const m = map[plan || 'free'] || map.free;
  return <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: m.bg, color: m.color }}>{m.label}</span>;
};

// ============================================================
// GRANT MODAL (bulk subscription/discount grants)
// ============================================================
const GrantModal: React.FC<{ storeIds: string[]; onClose: () => void; onDone: () => void }> = ({ storeIds, onClose, onDone }) => {
  const [type, setType] = useState<'discount' | 'free'>('free');
  const [discount, setDiscount] = useState(50);
  const [duration, setDuration] = useState<'week' | 'month' | '3months' | 'year' | 'custom'>('month');
  const [customDays, setCustomDays] = useState(30);

  const apply = async () => {
    const days = duration === 'week' ? 7 : duration === 'month' ? 30 : duration === '3months' ? 90 : duration === 'year' ? 365 : customDays;
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const updates = storeIds.map(id => supabase.from('store_profiles').upsert({
      store_id: id,
      subscription_plan: type === 'free' ? 'premium' : 'basic',
      discount_percentage: type === 'discount' ? discount : 0,
      subscription_expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }));
    await Promise.all(updates);
    await logActivity('admin_grant_subscription', {
      severity: 'success',
      metadata: { count: storeIds.length, type, duration, days, discount: type === 'discount' ? discount : 0 }
    });
    onDone();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ background: 'var(--card-bg, #fff)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 460 }}>
        <h3 style={{ margin: 0, marginBottom: 16, fontSize: 16, fontWeight: 900 }}>🎁 منح اشتراك / خصم لـ {storeIds.length} متجر</h3>
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={fieldLabel2}>نوع المنحة</div>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
              <button onClick={() => setType('free')}     style={pill(type === 'free')}>🎁 اشتراك ممتاز مجاني</button>
              <button onClick={() => setType('discount')} style={pill(type === 'discount')}>📉 خصم نسبة</button>
            </div>
          </div>
          {type === 'discount' && (
            <div>
              <div style={fieldLabel2}>نسبة الخصم: {discount}%</div>
              <input type="range" min={5} max={100} step={5} value={discount} onChange={e => setDiscount(+e.target.value)} style={{ width: '100%' }} />
            </div>
          )}
          <div>
            <div style={fieldLabel2}>المدة</div>
            <select value={duration} onChange={e => setDuration(e.target.value as any)} style={fieldInput2}>
              <option value="week">أسبوع</option>
              <option value="month">شهر</option>
              <option value="3months">3 أشهر</option>
              <option value="year">سنة كاملة</option>
              <option value="custom">مخصص (أيام)</option>
            </select>
          </div>
          {duration === 'custom' && (
            <div>
              <div style={fieldLabel2}>عدد الأيام</div>
              <input type="number" min={1} value={customDays} onChange={e => setCustomDays(+e.target.value)} style={fieldInput2} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={apply} style={{ flex: 1, padding: 11, borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>تطبيق فوري</button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 10, background: 'var(--gray-50, #f1f5f9)', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>إلغاء</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// PRODUCTS TAB (cross-store)
// ============================================================
const ProductsTab: React.FC<{ onChanged: () => void; customConfirm: (m: string) => Promise<boolean>; customAlert: (m: string) => Promise<void> }> = ({ onChanged, customConfirm, customAlert }) => {
  const [deals, setDeals] = useState<AdminDealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'expired' | 'deleted'>('active');

  const reload = () => {
    setLoading(true);
    getAllDeals().then(d => { setDeals(d); setLoading(false); });
  };
  useEffect(reload, []);

  const filtered = deals.filter(d => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return d.item_name?.toLowerCase().includes(q) || d.shop_name?.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q);
  });

  const handleDelete = async (id: string, name: string) => {
    if (!await customConfirm(`حذف "${name}"؟`)) return;
    const { error } = await adminDeleteDeal(id);
    if (error) { customAlert('فشل: ' + error.message); return; }
    customAlert('تم الحذف');
    reload(); onChanged();
  };

  const togglePause = async (d: AdminDealRow) => {
    const newStatus = d.status === 'paused' ? 'active' : 'paused';
    const { error } = await supabase.from('deals').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', d.id);
    if (error) { customAlert('فشل: ' + error.message); return; }
    reload(); onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, padding: 12, border: '1px solid var(--border-color, #f1f5f9)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="🔍 ابحث في كل العروض..." value={search} onChange={e => setSearch(e.target.value)}
               style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 13, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
          {([['all','الكل'],['active','نشط'],['paused','موقوف'],['expired','منتهي'],['deleted','محذوف']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setStatusFilter(v as any)} style={pill(statusFilter === v)}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color, #f1f5f9)' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="📦" title="لا توجد عروض" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f8fafc)', textAlign: 'right' }}>
                <th style={tableHead}>العرض</th>
                <th style={tableHead}>المتجر</th>
                <th style={tableHead}>السعر</th>
                <th style={tableHead}>أداء</th>
                <th style={tableHead}>الحالة</th>
                <th style={tableHead}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--border-color, #f1f5f9)' }}>
                  <td style={tableCell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {d.images?.[0] && <img src={d.images[0]} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />}
                      <div>
                        <div style={{ fontWeight: 800 }}>{d.item_name}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>{d.category}</div>
                      </div>
                    </div>
                  </td>
                  <td style={tableCell}>{d.shop_name}</td>
                  <td style={tableCell}>
                    <div style={{ fontWeight: 800 }}>{d.discounted_price} ر.س</div>
                    <div style={{ fontSize: 10, textDecoration: 'line-through', color: '#94a3b8' }}>{d.original_price}</div>
                  </td>
                  <td style={tableCell}>
                    <div style={{ fontSize: 11 }}>👁️ {d.views ?? 0}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>🖱️ {d.clicks ?? 0}</div>
                  </td>
                  <td style={tableCell}>
                    <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6,
                                   background: d.status === 'active' ? '#dcfce7' : d.status === 'paused' ? '#fef3c7' : d.status === 'expired' ? '#fee2e2' : '#e2e8f0',
                                   color: d.status === 'active' ? '#166534' : d.status === 'paused' ? '#854d0e' : d.status === 'expired' ? '#991b1b' : '#475569' }}>
                      {d.status === 'active' ? 'نشط' : d.status === 'paused' ? 'موقوف' : d.status === 'expired' ? 'منتهي' : 'محذوف'}
                    </span>
                  </td>
                  <td style={tableCell}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.status !== 'deleted' && (
                        <button onClick={() => togglePause(d)} style={{ padding: '5px 9px', borderRadius: 7, background: 'var(--gray-50, #f1f5f9)', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                          {d.status === 'paused' ? '▶' : '⏸'}
                        </button>
                      )}
                      <button onClick={() => handleDelete(d.id, d.item_name)} style={{ padding: '5px 9px', borderRadius: 7, background: '#fee2e2', color: '#991b1b', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============================================================
// USERS TAB
// ============================================================
const UsersTab: React.FC<{ onChanged: () => void; customConfirm: (m: string) => Promise<boolean>; customAlert: (m: string) => Promise<void> }> = ({ onChanged, customConfirm, customAlert }) => {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'buyer' | 'seller' | 'admin'>('all');

  const reload = () => {
    setLoading(true);
    getAllUsers(typeFilter === 'all' ? undefined : typeFilter).then(d => { setUsers(d); setLoading(false); });
  };
  useEffect(reload, [typeFilter]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return u.name?.toLowerCase().includes(q) || u.phone?.includes(q) || u.email?.toLowerCase().includes(q) || u.address?.toLowerCase().includes(q);
  });

  const toggle = async (u: AdminUserRow) => {
    if (u.is_active === false) {
      const { error } = await unsuspendUser(u.id);
      if (error) { customAlert('فشل: ' + error.message); return; }
    } else {
      if (!await customConfirm(`تعليق ${u.name}؟`)) return;
      const { error } = await suspendUser(u.id, 'admin action');
      if (error) { customAlert('فشل: ' + error.message); return; }
    }
    reload(); onChanged();
  };

  const isOnline = (u: AdminUserRow) => u.last_seen_at && (Date.now() - new Date(u.last_seen_at).getTime() < 5 * 60_000);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, padding: 12, border: '1px solid var(--border-color, #f1f5f9)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="🔍 ابحث بالاسم، الجوال، البريد، أو المدينة..." value={search} onChange={e => setSearch(e.target.value)}
               style={{ flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 13, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
          {([['all','الكل'],['buyer','مشتري'],['seller','تاجر'],['admin','مشرف']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setTypeFilter(v as any)} style={pill(typeFilter === v)}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color, #f1f5f9)' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="👥" title="لا يوجد مستخدمون" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f8fafc)', textAlign: 'right' }}>
                <th style={tableHead}>المستخدم</th>
                <th style={tableHead}>النوع</th>
                <th style={tableHead}>المدينة</th>
                <th style={tableHead}>حجوزات</th>
                <th style={tableHead}>وفّر</th>
                <th style={tableHead}>آخر نشاط</th>
                <th style={tableHead}>الحالة</th>
                <th style={tableHead}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border-color, #f1f5f9)' }}>
                  <td style={tableCell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 900, fontSize: 12
                        }}>{(u.name || '?').charAt(0)}</div>
                        {isOnline(u) && (
                          <span style={{ position: 'absolute', bottom: -1, insetInlineEnd: -1, width: 10, height: 10, borderRadius: '50%', background: '#10b981', border: '2px solid #fff' }} />
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800 }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }} dir="ltr">{u.phone || u.email || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={tableCell}>
                    <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6,
                                   background: u.user_type === 'admin' ? '#fee2e2' : u.user_type === 'seller' ? '#dcfce7' : '#dbeafe',
                                   color: u.user_type === 'admin' ? '#991b1b' : u.user_type === 'seller' ? '#166534' : '#1e40af' }}>
                      {u.user_type === 'admin' ? 'مشرف' : u.user_type === 'seller' ? 'تاجر' : 'مشتري'}
                    </span>
                  </td>
                  <td style={tableCell}>{u.address || '—'}</td>
                  <td style={tableCell}>{u.bookings_count ?? 0}</td>
                  <td style={tableCell}>{(u.savings ?? 0).toLocaleString('ar-SA')} ر.س</td>
                  <td style={tableCell}>{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                  <td style={tableCell}>
                    {u.is_active === false ? (
                      <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: '#fee2e2', color: '#991b1b' }}>معلّق</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>نشط</span>
                    )}
                  </td>
                  <td style={tableCell}>
                    {u.user_type !== 'admin' && (
                      <button onClick={() => toggle(u)} style={{
                        padding: '5px 10px', borderRadius: 7,
                        background: u.is_active === false ? '#10b981' : '#fef3c7',
                        color: u.is_active === false ? '#fff' : '#854d0e',
                        border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer'
                      }}>{u.is_active === false ? 'إعادة تفعيل' : 'تعليق'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============================================================
// BANNERS TAB
// ============================================================
const BannersTab: React.FC<{ onChanged: () => void; customAlert: (m: string) => Promise<void>; customConfirm: (m: string) => Promise<boolean> }> = ({ onChanged, customAlert, customConfirm }) => {
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminBanner | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => {
    setLoading(true);
    getAllBanners().then(d => { setBanners(d); setLoading(false); });
  };
  useEffect(reload, []);

  const remove = async (id: string) => {
    if (!await customConfirm('حذف هذا البانر؟')) return;
    const { error } = await supabase.from('banners').delete().eq('id', id);
    if (error) { customAlert('فشل: ' + error.message); return; }
    reload(); onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>🖼️ إدارة البانرات الإعلانية</h2>
        <button onClick={() => setCreating(true)} style={{ padding: '9px 16px', borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
          ➕ بانر جديد
        </button>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>جاري التحميل...</div>
      ) : banners.length === 0 ? (
        <EmptyState icon="🖼️" title="لا توجد بانرات" subtitle="أضف أول بانر ليظهر في الصفحة الرئيسية" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {banners.map(b => (
            <div key={b.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color, #f1f5f9)' }}>
              <div style={{ position: 'relative', height: 130, background: b.background_color || '#f1f5f9' }}>
                {b.image_url && <img src={b.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                <div style={{ position: 'absolute', top: 8, insetInlineStart: 8, display: 'flex', gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: b.is_active ? '#10b981' : '#94a3b8', color: '#fff' }}>
                    {b.is_active ? '🟢 نشط' : 'موقوف'}
                  </span>
                  {b.discount_percentage ? (
                    <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: '#ef4444', color: '#fff' }}>{b.discount_percentage}%</span>
                  ) : null}
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 900 }}>{b.title_ar || '—'}</div>
                {b.subtitle_ar && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>{b.subtitle_ar}</div>}
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, fontWeight: 700 }}>
                  <span>👁️ {b.view_count ?? 0}</span>
                  <span>🖱️ {b.click_count ?? 0}</span>
                  <span>📍 {b.position}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button onClick={() => setEditing(b)} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'var(--gray-50, #f1f5f9)', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>✏️ تعديل</button>
                  <button onClick={async () => {
                    await supabase.from('banners').update({ is_active: !b.is_active }).eq('id', b.id);
                    reload();
                  }} style={{ flex: 1, padding: 7, borderRadius: 8, background: b.is_active ? '#fef3c7' : '#dcfce7', color: b.is_active ? '#854d0e' : '#166534', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    {b.is_active ? '⏸ إيقاف' : '▶ تفعيل'}
                  </button>
                  <button onClick={() => remove(b.id)} style={{ padding: '7px 12px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {(creating || editing) && (
        <BannerEditor banner={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); reload(); onChanged(); }} />
      )}
    </div>
  );
};

const BannerEditor: React.FC<{ banner: AdminBanner | null; onClose: () => void; onSaved: () => void }> = ({ banner, onClose, onSaved }) => {
  const [form, setForm] = useState({
    title_ar: banner?.title_ar || '',
    title_en: banner?.title_en || '',
    subtitle_ar: banner?.subtitle_ar || '',
    subtitle_en: banner?.subtitle_en || '',
    image_url: banner?.image_url || '',
    target_url: banner?.target_url || '',
    deal_id: banner?.deal_id || '',
    store_id: banner?.store_id || '',
    position: banner?.position || 'home_top',
    is_active: banner?.is_active ?? true,
    discount_percentage: banner?.discount_percentage ?? null as number | null,
    amount: banner?.amount ?? null as number | null,
    target_city: banner?.target_city || '',
    starts_at: banner?.starts_at ? banner.starts_at.slice(0, 10) : '',
    expires_at: banner?.expires_at ? banner.expires_at.slice(0, 10) : '',
    priority: banner?.priority ?? 0,
    cta_label_ar: banner?.cta_label_ar || '',
    cta_label_en: banner?.cta_label_en || '',
    background_color: banner?.background_color || '',
  });

  const save = async () => {
    if (!form.image_url) { alert('رابط الصورة مطلوب'); return; }
    const payload = {
      ...form,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      deal_id: form.deal_id || null,
      store_id: form.store_id || null,
      target_city: form.target_city || null,
      cta_label_ar: form.cta_label_ar || null,
      cta_label_en: form.cta_label_en || null,
      background_color: form.background_color || null,
      target_url: form.target_url || null,
    };
    const { error } = banner
      ? await supabase.from('banners').update(payload).eq('id', banner.id)
      : await supabase.from('banners').insert([payload]);
    if (error) { alert(error.message); return; }
    onSaved();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ background: 'var(--card-bg, #fff)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: 0, marginBottom: 16, fontSize: 16, fontWeight: 900 }}>{banner ? '✏️ تعديل البانر' : '➕ بانر جديد'}</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldX label="العنوان (عربي)" value={form.title_ar} onChange={v => setForm({ ...form, title_ar: v })} />
            <FieldX label="العنوان (English)" value={form.title_en} onChange={v => setForm({ ...form, title_en: v })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldX label="نص فرعي (عربي)" value={form.subtitle_ar} onChange={v => setForm({ ...form, subtitle_ar: v })} />
            <FieldX label="نص فرعي (English)" value={form.subtitle_en} onChange={v => setForm({ ...form, subtitle_en: v })} />
          </div>
          <FieldX label="🖼️ رابط الصورة *" value={form.image_url} onChange={v => setForm({ ...form, image_url: v })} placeholder="https://..." />
          <FieldX label="🔗 رابط التوجيه (اختياري)" value={form.target_url} onChange={v => setForm({ ...form, target_url: v })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FieldX type="number" label="نسبة الخصم %" value={form.discount_percentage?.toString() || ''} onChange={v => setForm({ ...form, discount_percentage: v ? +v : null })} />
            <FieldX type="number" label="المبلغ (ر.س)" value={form.amount?.toString() || ''} onChange={v => setForm({ ...form, amount: v ? +v : null })} />
            <FieldX type="number" label="الأولوية" value={String(form.priority)} onChange={v => setForm({ ...form, priority: +v })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldX type="date" label="📅 تاريخ البدء" value={form.starts_at} onChange={v => setForm({ ...form, starts_at: v })} />
            <FieldX type="date" label="📅 تاريخ الانتهاء" value={form.expires_at} onChange={v => setForm({ ...form, expires_at: v })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldX label="مدينة مستهدفة (اختياري)" value={form.target_city} onChange={v => setForm({ ...form, target_city: v })} />
            <div>
              <label style={fieldLabel2}>📍 المكان</label>
              <select value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} style={fieldInput2}>
                <option value="home_top">أعلى الصفحة الرئيسية</option>
                <option value="category_top">أعلى التصنيفات</option>
                <option value="nearby">صفحة القريب</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FieldX label="نص زر الإجراء (عربي)" value={form.cta_label_ar} onChange={v => setForm({ ...form, cta_label_ar: v })} placeholder="تسوّق الآن" />
            <FieldX label="ID العرض/المتجر (اختياري)" value={form.deal_id || form.store_id} onChange={v => setForm({ ...form, deal_id: v })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            تفعيل البانر فوراً
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={save} style={{ flex: 1, padding: 11, borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>💾 {banner ? 'حفظ التعديلات' : 'نشر البانر'}</button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 10, background: 'var(--gray-50, #f1f5f9)', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>إلغاء</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// LIVE TAB
// ============================================================
const LiveTab: React.FC = () => (
  <SectionCard title="⚡ النشاط الحي" subtitle="جميع الأحداث على المنصة تصل إليك فوراً">
    <LiveActivityFeed limit={100} />
  </SectionCard>
);

// ============================================================
// SETTINGS TAB
// ============================================================
const SettingsTab: React.FC<{ customAlert: (m: string) => Promise<void> }> = ({ customAlert }) => {
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  useEffect(() => {
    supabase.from('global_settings').select('value').eq('key', 'is_payment_gateway_enabled').single()
      .then(({ data }) => { if (data) setPaymentEnabled(data.value === 'true'); });
  }, []);

  const togglePayment = async () => {
    const v = !paymentEnabled;
    setPaymentEnabled(v);
    await supabase.from('global_settings').upsert({ key: 'is_payment_gateway_enabled', value: String(v), updated_at: new Date().toISOString() });
    await logActivity('admin_toggle_payment_gateway', { severity: 'warning', metadata: { enabled: v } });
    customAlert(v ? 'تم تفعيل بوابة الدفع' : 'تم تعطيل بوابة الدفع');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionCard title="بوابة الدفع (SaaS)" subtitle={paymentEnabled ? 'مفعلة — التطبيق مدفوع' : 'معطلة ومخفية — التطبيق مجاني'}>
        <button onClick={togglePayment} style={{
          padding: '10px 20px', borderRadius: 10,
          background: paymentEnabled ? '#fee2e2' : '#10b981',
          color: paymentEnabled ? '#991b1b' : '#fff',
          border: 'none', fontWeight: 900, fontSize: 13, cursor: 'pointer'
        }}>{paymentEnabled ? '⛔ تعطيل البوابة' : '✅ تفعيل البوابة'}</button>
      </SectionCard>
      <SectionCard title="حول النظام" subtitle="معلومات تشغيلية">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8 }}>
          <div>• قاعدة البيانات: Supabase (RLS مفعّل)</div>
          <div>• المصادقة: Supabase Auth</div>
          <div>• الإصدار: 7.2.0 — Admin Center v2 (migration v15)</div>
          <div>• كل عملية إدارية يتم تسجيلها في activity_log للمراجعة</div>
        </div>
      </SectionCard>
    </div>
  );
};

// ============== shared inline styles ==============
const tableHead: React.CSSProperties = { padding: '12px 14px', fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'right' };
const tableCell: React.CSSProperties = { padding: '12px 14px', fontSize: 12, color: 'var(--text-primary)', verticalAlign: 'middle' };
const fieldLabel2: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 };
const fieldInput2: React.CSSProperties = { width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 13, background: '#fff', fontFamily: 'inherit' };
const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 8, border: 'none',
  background: active ? '#fff' : 'transparent',
  fontSize: 12, fontWeight: 800, cursor: 'pointer',
  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none'
});

const FieldX: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div>
    <label style={fieldLabel2}>{label}</label>
    <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={fieldInput2} />
  </div>
);

export default AdminDashboard;
