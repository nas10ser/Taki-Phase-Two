import React from 'react';

/**
 * Lightweight admin-only UI primitives. Pure SVG / inline styles so we
 * don't pull a chart library into the buyer bundle. Designed for RTL.
 */

// ============================================================
// KPICard — single metric with delta + sparkline
// ============================================================
interface KPICardProps {
  label: string;
  value: number | string;
  icon?: string;
  hint?: string;
  delta?: number;          // % change vs prior period
  trend?: number[];        // sparkline data
  accent?: string;         // border / glow color
  loading?: boolean;
  onClick?: () => void;
}

export const KPICard: React.FC<KPICardProps> = ({
  label, value, icon, hint, delta, trend, accent = '#10b981', loading, onClick
}) => {
  const deltaPositive = (delta ?? 0) >= 0;
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card-bg, #fff)',
        border: '1px solid var(--border-color, #f1f5f9)',
        borderRadius: 16,
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{
        position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: 3,
        background: accent, borderStartStartRadius: 16, borderEndStartRadius: 16
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <div style={{ fontSize: 22 }}>{icon}</div>}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary, #64748b)' }}>{label}</div>
        </div>
        {typeof delta === 'number' && (
          <div style={{
            fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
            background: deltaPositive ? '#dcfce7' : '#fee2e2',
            color: deltaPositive ? '#166534' : '#991b1b'
          }}>
            {deltaPositive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary, #0f172a)', lineHeight: 1 }}>
        {loading ? '…' : value}
      </div>
      {hint && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #94a3b8)', marginTop: 4 }}>{hint}</div>}
      {trend && trend.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <Sparkline data={trend} color={accent} height={28} />
        </div>
      )}
    </div>
  );
};

// ============================================================
// Sparkline — tiny inline SVG line
// ============================================================
export const Sparkline: React.FC<{ data: number[]; color?: string; height?: number }> = ({ data, color = '#10b981', height = 32 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 100;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const lastX = width;
  const lastY = height - ((data[data.length - 1] - min) / range) * height;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#spark-${color.replace('#', '')})`}
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
};

// ============================================================
// AreaChart — multi-series area chart with axis & tooltip
// ============================================================
export interface ChartSeries {
  label: string;
  data: number[];
  color: string;
}

interface AreaChartProps {
  labels: string[];
  series: ChartSeries[];
  height?: number;
}

export const AreaChart: React.FC<AreaChartProps> = ({ labels, series, height = 220 }) => {
  const [hover, setHover] = React.useState<number | null>(null);
  if (!series.length || !labels.length) return null;
  const allValues = series.flatMap(s => s.data);
  const max = Math.max(...allValues, 1);
  const W = 600;
  const H = height;
  const PAD_L = 32, PAD_R = 12, PAD_T = 12, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xFor = (i: number) => PAD_L + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yFor = (v: number) => PAD_T + innerH - (v / max) * innerH;

  const ticks = 4;

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
        {/* grid */}
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = PAD_T + (i / ticks) * innerH;
          const v = Math.round(max - (i / ticks) * max);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(148,163,184,0.15)" strokeDasharray="2 3" />
              <text x={PAD_L - 4} y={y + 3} fontSize="9" textAnchor="end" fill="#94a3b8">{v}</text>
            </g>
          );
        })}
        {/* x labels — show ~5 ticks */}
        {labels.map((lbl, i) => {
          const stride = Math.max(1, Math.ceil(labels.length / 6));
          if (i % stride !== 0 && i !== labels.length - 1) return null;
          return (
            <text key={i} x={xFor(i)} y={H - 6} fontSize="9" textAnchor="middle" fill="#94a3b8">{lbl}</text>
          );
        })}
        {/* series */}
        {series.map((s, sIdx) => {
          const id = `area-${sIdx}-${s.color.replace('#', '')}`;
          const linePoints = s.data.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
          const areaPoints = `${PAD_L},${PAD_T + innerH} ${linePoints} ${W - PAD_R},${PAD_T + innerH}`;
          return (
            <g key={sIdx}>
              <defs>
                <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={areaPoints} fill={`url(#${id})`} />
              <polyline points={linePoints} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            </g>
          );
        })}
        {/* hover line */}
        {hover !== null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={PAD_T} y2={PAD_T + innerH} stroke="#94a3b8" strokeDasharray="2 2" />
        )}
        {/* hover dots */}
        {hover !== null && series.map((s, sIdx) => (
          <circle key={sIdx} cx={xFor(hover)} cy={yFor(s.data[hover] ?? 0)} r="3.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />
        ))}
        {/* invisible hit-area */}
        {labels.map((_, i) => (
          <rect key={i} x={xFor(i) - innerW / labels.length / 2} y={PAD_T} width={innerW / Math.max(1, labels.length)} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {/* tooltip */}
      {hover !== null && (
        <div style={{
          position: 'absolute', top: 8, insetInlineEnd: 8, background: 'rgba(15,23,42,0.92)',
          color: '#fff', padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
          backdropFilter: 'blur(6px)', minWidth: 140
        }}>
          <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 4 }}>{labels[hover]}</div>
          {series.map((s, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                {s.label}
              </span>
              <span>{s.data[hover] ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      {/* legend */}
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        {series.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// Donut chart
// ============================================================
interface DonutProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

export const Donut: React.FC<DonutProps> = ({ segments, size = 160, centerLabel, centerValue }) => {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 16;
  const cx = size / 2, cy = size / 2;
  let cumulative = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="14" />
        {segments.map((s, i) => {
          if (s.value === 0) return null;
          const start = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
          const end = ((cumulative + s.value) / total) * 2 * Math.PI - Math.PI / 2;
          cumulative += s.value;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          const largeArc = end - start > Math.PI ? 1 : 0;
          return (
            <path key={i}
                  d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                  fill="none" stroke={s.color} strokeWidth="14" strokeLinecap="butt" />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="900" fill="var(--text-primary, #0f172a)">
          {centerValue ?? total}
        </text>
        {centerLabel && (
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fontWeight="700" fill="#94a3b8">{centerLabel}</text>
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, minWidth: 80 }}>{s.label}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 900 }}>{s.value}</span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>({total > 0 ? ((s.value / total) * 100).toFixed(0) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// Horizontal bar list (for "Top X" tables)
// ============================================================
export const BarList: React.FC<{
  rows: { label: string; value: number; sub?: string; image?: string | null }[];
  color?: string;
  formatValue?: (n: number) => string;
}> = ({ rows, color = '#10b981', formatValue }) => {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {r.image ? (
            <img src={r.image} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: 'var(--gray-50, #f1f5f9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
              color: 'var(--text-secondary)', flexShrink: 0
            }}>{i + 1}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4,
              fontSize: 12, fontWeight: 700, color: 'var(--text-primary)'
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ color, fontWeight: 900 }}>{formatValue ? formatValue(r.value) : r.value.toLocaleString('ar-SA')}</span>
            </div>
            <div style={{ height: 5, background: 'var(--gray-50, #f1f5f9)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            {r.sub && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3, fontWeight: 600 }}>{r.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// SectionCard — wrapper for major dashboard sections
// ============================================================
export const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, action, children }) => (
  <div style={{
    background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #f1f5f9)',
    borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,0.04)'
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 8 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

// ============================================================
// Tab pill
// ============================================================
export const TabPill: React.FC<{
  active: boolean; icon: string; label: string; count?: number; onClick: () => void;
}> = ({ active, icon, label, count, onClick }) => (
  <button onClick={onClick} style={{
    padding: '10px 16px', borderRadius: 12, border: 'none',
    background: active ? 'var(--card-bg, #fff)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontWeight: 800, fontSize: 13, cursor: 'pointer',
    boxShadow: active ? '0 2px 8px rgba(15,23,42,0.06)' : 'none',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    transition: 'all 160ms ease'
  }}>
    <span>{icon}</span>
    <span>{label}</span>
    {typeof count === 'number' && (
      <span style={{
        background: active ? '#10b981' : 'var(--gray-50, #e2e8f0)',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 6, minWidth: 16, textAlign: 'center'
      }}>{count}</span>
    )}
  </button>
);

// ============================================================
// Empty state
// ============================================================
export const EmptyState: React.FC<{ icon: string; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div style={{
    padding: 40, textAlign: 'center', color: 'var(--text-secondary)',
    border: '2px dashed var(--border-color, #e2e8f0)', borderRadius: 12
  }}>
    <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.6 }}>{icon}</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</div>
    {subtitle && <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>{subtitle}</div>}
  </div>
);
