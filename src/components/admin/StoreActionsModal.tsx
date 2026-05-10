import React, { useEffect, useState } from 'react';
import {
  AdminStoreRow, AdminDealRow, getAllDeals, adminDeleteDeal,
  adminUpdateDeal, suspendUser, unsuspendUser, getSellerAnalytics,
  SellerAnalytics, startImpersonation, logActivity
} from '../../services/adminService';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import { useHistory } from 'react-router-dom';
import { KPICard, SectionCard, BarList, Donut, EmptyState } from './AdminUI';

interface Props {
  store: AdminStoreRow;
  onClose: () => void;
  onChanged?: () => void;
}

const StoreActionsModal: React.FC<Props> = ({ store, onClose, onChanged }) => {
  const { setViewAs, customAlert, customConfirm } = useApp();
  const history = useHistory();
  const [view, setView] = useState<'overview' | 'products' | 'profile'>('overview');
  const [deals, setDeals] = useState<AdminDealRow[]>([]);
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminDealRow | null>(null);
  const [editForm, setEditForm] = useState<{
    item_name: string; description: string; original_price: number; discounted_price: number; status: string;
  }>({ item_name: '', description: '', original_price: 0, discounted_price: 0, status: 'active' });

  // Profile editing
  const [profile, setProfile] = useState({
    name: store.name || '',
    shop: store.shop || '',
    phone: store.phone || '',
    address: store.address || '',
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAllDeals({ storeId: store.id }),
      getSellerAnalytics(store.id),
    ]).then(([d, a]) => {
      setDeals(d);
      setAnalytics(a);
      setLoading(false);
    });
  }, [store.id]);

  const refresh = async () => {
    const [d, a] = await Promise.all([getAllDeals({ storeId: store.id }), getSellerAnalytics(store.id)]);
    setDeals(d);
    setAnalytics(a);
    onChanged?.();
  };

  const handleDeleteDeal = async (id: string, name: string) => {
    if (!await customConfirm(`حذف العرض "${name}"؟ لا يمكن التراجع.`)) return;
    const { error } = await adminDeleteDeal(id);
    if (error) { customAlert('فشل الحذف: ' + error.message); return; }
    customAlert('تم حذف العرض');
    refresh();
  };

  const startEdit = (deal: AdminDealRow) => {
    setEditing(deal);
    setEditForm({
      item_name: deal.item_name,
      description: '',
      original_price: deal.original_price,
      discounted_price: deal.discounted_price,
      status: deal.status,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await adminUpdateDeal(editing.id, editForm);
    if (error) { customAlert('فشل التعديل: ' + error.message); return; }
    customAlert('تم الحفظ');
    setEditing(null);
    refresh();
  };

  const handleImpersonate = async () => {
    if (!await customConfirm(`الدخول كحساب "${store.shop || store.name}"؟ سيتم تسجيل العملية في السجل.`)) return;
    const logId = await startImpersonation(store.id, 'admin store inspection');
    if (logId) {
      // Cache the log id so we can end the session later
      try { sessionStorage.setItem('TAKI_IMPERSONATION_LOG', String(logId)); } catch {}
    }
    setViewAs('seller');
    onClose();
    history.push('/seller');
  };

  const toggleSuspension = async () => {
    const isSuspended = store.is_active === false;
    if (isSuspended) {
      const { error } = await unsuspendUser(store.id);
      if (error) { customAlert('فشل: ' + error.message); return; }
      customAlert('تم إعادة تفعيل المتجر');
    } else {
      if (!await customConfirm('تعليق هذا المتجر؟ لن يتمكن من الدخول حتى يُعاد تفعيله.')) return;
      const { error } = await suspendUser(store.id, 'تعليق إداري');
      if (error) { customAlert('فشل: ' + error.message); return; }
      customAlert('تم تعليق المتجر');
    }
    onChanged?.();
  };

  const saveProfile = async () => {
    const { error } = await supabase.from('users').update({
      name: profile.name, shop: profile.shop, phone: profile.phone, address: profile.address,
      updated_at: new Date().toISOString()
    }).eq('id', store.id);
    if (error) { customAlert('فشل التعديل: ' + error.message); return; }
    await logActivity('admin_edit_store_profile', { targetTable: 'users', targetId: store.id });
    customAlert('تم حفظ بيانات المتجر');
    onChanged?.();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000, padding: 16, background: 'rgba(15,23,42,0.55)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{
        width: '100%', maxWidth: 980, maxHeight: '92vh', background: 'var(--card-bg, #fff)',
        borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 30px 80px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: 18, borderBottom: '1px solid var(--border-color, #f1f5f9)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, #f8fafc, #fff)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {store.avatar_url ? (
              <img src={store.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: '#10b981',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22
              }}>🏪</div>
            )}
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)' }}>{store.shop || store.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2 }}>
                {store.address || 'بدون عنوان'} • {store.phone || '—'}
                {store.is_active === false && <span style={{ color: '#ef4444', marginInlineStart: 8 }}> • معلّق</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 10, border: 'none',
            background: 'var(--gray-50, #f1f5f9)', cursor: 'pointer', fontSize: 16
          }}>✕</button>
        </div>

        {/* Action bar */}
        <div style={{
          padding: '10px 18px', display: 'flex', gap: 8, flexWrap: 'wrap',
          borderBottom: '1px solid var(--border-color, #f1f5f9)', background: 'var(--card-bg, #fff)'
        }}>
          <button onClick={handleImpersonate} style={btnPrimary}>👁️ دخول كهذا المتجر</button>
          <button onClick={toggleSuspension} style={store.is_active === false ? btnSuccess : btnWarning}>
            {store.is_active === false ? '🟢 إعادة تفعيل' : '🚫 تعليق المتجر'}
          </button>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4, padding: 4, background: 'var(--gray-50, #f1f5f9)', borderRadius: 10 }}>
            {(['overview','products','profile'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '6px 12px', borderRadius: 8, border: 'none',
                background: view === v ? '#fff' : 'transparent',
                fontSize: 12, fontWeight: 800, cursor: 'pointer',
                color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: view === v ? '0 1px 4px rgba(0,0,0,0.08)' : 'none'
              }}>
                {v === 'overview' ? '📊 ملخص' : v === 'products' ? `📦 العروض (${deals.length})` : '⚙️ بيانات'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, background: 'var(--bg, #f8fafc)' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>جاري التحميل...</div>
          ) : view === 'overview' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {analytics && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                    <KPICard label="إجمالي العروض" value={analytics.totals.deals_total} icon="📦" accent="#3b82f6" />
                    <KPICard label="مشاهدات" value={analytics.totals.views.toLocaleString('ar-SA')} icon="👁️" accent="#8b5cf6" />
                    <KPICard label="حجوزات" value={analytics.totals.bookings} icon="🎟️" accent="#10b981" />
                    <KPICard label="تقييم" value={analytics.totals.avg_rating || '—'} hint={`${analytics.totals.rating_count} تقييم`} icon="⭐" accent="#f59e0b" />
                    <KPICard label="متابعون" value={analytics.totals.followers} icon="❤️" accent="#ec4899" />
                    <KPICard label="إيراد تقديري" value={`${Math.round(analytics.totals.revenue_estimate).toLocaleString('ar-SA')} ر.س`} icon="💰" accent="#06b6d4" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <SectionCard title="حالة الحجوزات" subtitle="آخر 30 يوم">
                      <Donut
                        centerLabel="حجز"
                        centerValue={analytics.totals.bookings}
                        segments={[
                          { label: 'مكتمل',  value: analytics.totals.bookings_completed, color: '#10b981' },
                          { label: 'معلق',   value: analytics.totals.bookings_pending,   color: '#f59e0b' },
                          { label: 'ملغى',   value: analytics.totals.bookings_cancelled, color: '#ef4444' },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title="أكثر العروض مشاهدة">
                      {analytics.top_deals.length === 0 ? (
                        <EmptyState icon="📭" title="لا توجد عروض" />
                      ) : (
                        <BarList
                          color="#3b82f6"
                          rows={analytics.top_deals.slice(0, 5).map(d => ({
                            label: d.name,
                            value: d.views,
                            sub: `${d.bookings} حجز • ${d.clicks} نقرة`,
                            image: d.image
                          }))}
                        />
                      )}
                    </SectionCard>
                  </div>
                </>
              )}
            </div>
          ) : view === 'products' ? (
            <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, padding: 4 }}>
              {deals.length === 0 ? (
                <EmptyState icon="📦" title="لا توجد عروض لهذا المتجر" />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50, #f8fafc)', textAlign: 'right' }}>
                      <th style={th}>العرض</th>
                      <th style={th}>السعر</th>
                      <th style={th}>الخصم</th>
                      <th style={th}>المشاهدات</th>
                      <th style={th}>الحالة</th>
                      <th style={th}>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map(d => (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--border-color, #f1f5f9)' }}>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {d.images?.[0] && <img src={d.images[0]} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />}
                            <span style={{ fontWeight: 700 }}>{d.item_name}</span>
                          </div>
                        </td>
                        <td style={td}>{d.discounted_price} <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: 10, marginInlineStart: 4 }}>{d.original_price}</span></td>
                        <td style={td}>{d.discount_percentage ?? '—'}%</td>
                        <td style={td}>{d.views ?? 0}</td>
                        <td style={td}><StatusBadge status={d.status} /></td>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => startEdit(d)} style={btnGhost}>✏️</button>
                            <button onClick={() => handleDeleteDeal(d.id, d.item_name)} style={{ ...btnGhost, color: '#ef4444' }}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 14, padding: 18, display: 'grid', gap: 14, maxWidth: 600 }}>
              <Field label="اسم التاجر" value={profile.name} onChange={v => setProfile({ ...profile, name: v })} />
              <Field label="اسم المتجر / السجل" value={profile.shop} onChange={v => setProfile({ ...profile, shop: v })} />
              <Field label="رقم الجوال" value={profile.phone} onChange={v => setProfile({ ...profile, phone: v })} />
              <Field label="المدينة / العنوان" value={profile.address} onChange={v => setProfile({ ...profile, address: v })} />
              <button onClick={saveProfile} style={{ ...btnPrimary, marginTop: 4, padding: '10px 18px' }}>💾 حفظ التعديلات</button>
            </div>
          )}
        </div>

        {/* Edit deal modal */}
        {editing && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
          }}>
            <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480 }}>
              <h3 style={{ margin: 0, marginBottom: 14, fontSize: 16, fontWeight: 900 }}>تعديل العرض</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                <Field label="اسم المنتج" value={editForm.item_name} onChange={v => setEditForm({ ...editForm, item_name: v })} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field type="number" label="السعر الأصلي" value={String(editForm.original_price)} onChange={v => setEditForm({ ...editForm, original_price: Number(v) })} />
                  <Field type="number" label="السعر بعد الخصم" value={String(editForm.discounted_price)} onChange={v => setEditForm({ ...editForm, discounted_price: Number(v) })} />
                </div>
                <div>
                  <label style={fieldLabel}>الحالة</label>
                  <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} style={fieldInput}>
                    <option value="active">نشط</option>
                    <option value="paused">موقوف</option>
                    <option value="expired">منتهي</option>
                    <option value="deleted">محذوف</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={saveEdit} style={{ ...btnPrimary, flex: 1 }}>حفظ</button>
                <button onClick={() => setEditing(null)} style={btnGhost}>إلغاء</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============== inline styles ==============
const btnPrimary: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' };
const btnWarning: React.CSSProperties = { ...btnPrimary, background: '#f59e0b' };
const btnSuccess: React.CSSProperties = { ...btnPrimary, background: '#059669' };
const btnGhost: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, background: 'var(--gray-50, #f1f5f9)', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'right' };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: 'var(--text-primary)' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 4 };
const fieldInput: React.CSSProperties = { width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 13, background: '#fff', fontFamily: 'inherit' };

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    active:  { color: '#166534', bg: '#dcfce7', label: 'نشط' },
    paused:  { color: '#854d0e', bg: '#fef3c7', label: 'موقوف' },
    expired: { color: '#991b1b', bg: '#fee2e2', label: 'منتهي' },
    deleted: { color: '#475569', bg: '#e2e8f0', label: 'محذوف' },
  };
  const m = map[status] || { color: '#475569', bg: '#e2e8f0', label: status };
  return <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: m.bg, color: m.color }}>{m.label}</span>;
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label style={fieldLabel}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} style={fieldInput} />
  </div>
);

export default StoreActionsModal;
