import React, { useEffect, useRef, useState } from 'react';
import { ActivityRow, getRecentActivity, subscribeToActivity } from '../../services/adminService';

const eventDisplay: Record<string, { icon: string; label: string; color: string }> = {
  user_registered:        { icon: '👤', label: 'تسجيل مستخدم جديد', color: '#10b981' },
  deal_created:           { icon: '🛍️', label: 'عرض جديد',         color: '#3b82f6' },
  deal_status_changed:    { icon: '🔄', label: 'تغيير حالة عرض',   color: '#f59e0b' },
  booking_created:        { icon: '🎟️', label: 'حجز جديد',         color: '#8b5cf6' },
  booking_acknowledged:   { icon: '📦', label: 'استلام طلب',       color: '#06b6d4' },
  booking_completed:      { icon: '✅', label: 'تم تسليم الطلب',   color: '#10b981' },
  booking_cancelled:      { icon: '⛔', label: 'إلغاء حجز',         color: '#ef4444' },
  admin_suspend_user:     { icon: '🚫', label: 'تعليق مستخدم',     color: '#ef4444' },
  admin_unsuspend_user:   { icon: '🟢', label: 'إعادة تفعيل مستخدم', color: '#10b981' },
  admin_delete_deal:      { icon: '🗑️', label: 'حذف عرض (إدارة)',  color: '#ef4444' },
  impersonation_start:    { icon: '👁️', label: 'بدء معاينة كحساب', color: '#f97316' },
  impersonation_end:      { icon: '👁️‍🗨️', label: 'إنهاء المعاينة',  color: '#64748b' },
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `قبل ${sec} ثانية`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  return d.toLocaleDateString('ar-SA');
};

interface Props {
  limit?: number;
  filterEventTypes?: string[];
}

const LiveActivityFeed: React.FC<Props> = ({ limit = 50, filterEventTypes }) => {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'success' | 'warning'>('all');
  const flashIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    getRecentActivity(limit).then(data => {
      if (!active) return;
      const filtered = filterEventTypes ? data.filter(r => filterEventTypes.includes(r.event_type)) : data;
      setRows(filtered);
      setLoading(false);
    });
    const unsub = subscribeToActivity((row) => {
      if (filterEventTypes && !filterEventTypes.includes(row.event_type)) return;
      flashIds.current.add(row.id);
      setRows(prev => [row, ...prev].slice(0, limit));
      setTimeout(() => { flashIds.current.delete(row.id); }, 1800);
    });
    return () => { active = false; unsub(); };
  }, [limit, filterEventTypes]);

  const filtered = rows.filter(r => filter === 'all' || r.severity === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { v: 'all',      l: 'الكل',     c: '#64748b' },
          { v: 'success',  l: '✅ نجاح',  c: '#10b981' },
          { v: 'warning',  l: '⚠️ تنبيه', c: '#f59e0b' },
          { v: 'critical', l: '🔴 حرج',   c: '#ef4444' },
        ].map(f => (
          <button key={f.v} onClick={() => setFilter(f.v as any)} style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800,
            background: filter === f.v ? f.c : 'var(--gray-50, #f1f5f9)',
            color: filter === f.v ? '#fff' : 'var(--text-secondary)',
            border: 'none', cursor: 'pointer'
          }}>{f.l}</button>
        ))}
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#10b981' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#10b981',
            animation: 'taki-pulse 1.6s ease-in-out infinite'
          }} />
          <span>مباشر</span>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>لا توجد أحداث</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
          {filtered.map(row => {
            const meta = eventDisplay[row.event_type] || { icon: '🔵', label: row.event_type, color: '#64748b' };
            const flash = flashIds.current.has(row.id);
            return (
              <div key={row.id} style={{
                display: 'flex', gap: 10, padding: 10, borderRadius: 10,
                background: flash ? `${meta.color}15` : 'transparent',
                border: '1px solid var(--border-color, #f1f5f9)',
                transition: 'background 800ms ease',
                animation: flash ? 'taki-fade-in 320ms ease' : undefined
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${meta.color}18`, flexShrink: 0
                }}>{meta.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                    {row.metadata?.item_name && <span>{row.metadata.item_name} • </span>}
                    {row.metadata?.shop_name && <span>{row.metadata.shop_name} • </span>}
                    {row.metadata?.name && <span>{row.metadata.name} • </span>}
                    {row.actor_type && <span>{row.actor_type} • </span>}
                    <span>{formatTime(row.created_at)}</span>
                  </div>
                </div>
                {row.severity === 'critical' && <span style={{ fontSize: 10, fontWeight: 900, color: '#ef4444' }}>حرج</span>}
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        @keyframes taki-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
        @keyframes taki-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default LiveActivityFeed;
