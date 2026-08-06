import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { StoreBranch } from '../repositories/branchRepository';
import { coordsOf, directionsLink } from '../utils/mapLinks';

/**
 * StoreBranchesMap — «اعرض كل المواقع على الخريطة» (v13.66، تفاعلية في v13.69)
 *
 * ما كان يحدث قبل v13.66: الزرّ يفتح **بحثاً في قوقل باسم المتجر**، فلا علاقة
 * لما يظهر بفروع المتجر إطلاقاً (بلاغ ناصر: «لا يعرضلي الثلاث الظاهرة بالأعلى»).
 *
 * v13.69 (طلب ناصر) — صارت الخريطة تُقاد لا تُشاهَد فقط:
 *  • الضغط على اسم الفرع في القائمة → الخريطة **تطير** إليه وتفتح بطاقته.
 *  • الضغط على الدبّوس → بطاقة فيها خياران صريحان: **فتح في قوقل ماب**
 *    (للملاحة) أو **البقاء هنا** (تُغلق البطاقة ويكمل تصفّحه داخل التطبيق).
 *  • زرّ **«عرض كل المواقع»** يعيد الإطار ليضمّ كل الدبابيس — يظهر فقط بعد
 *    التركيز على واحد، فلا يزحم الشاشة قبل الحاجة إليه.
 *
 * الدبابيس `divIcon` (HTML) لا صور: لا ملف أيقونة يُحمَّل، والرقم يطابق ترتيب
 * الفرع في القائمة أسفل الخريطة فيربط المستخدم بينهما بنظرة.
 */

interface Props {
    branches: StoreBranch[];
    storeName: string;
    isRTL: boolean;
    onClose: () => void;
}

type Focus = { index: number; seq: number } | null;

/**
 * قائد الخريطة. مفصول عن الحاوية لأن `useMap` لا يعمل إلا داخل `MapContainer`.
 * `fitSeq` عدّاد لا قيمة منطقية: الضغط على «عرض كل المواقع» مرتين متتاليتين
 * يجب أن يعيد الإطار في المرتين، ولو كان شرطاً منطقياً لما تغيّر في الثانية.
 */
const MapController: React.FC<{ points: [number, number][]; focus: Focus; fitSeq: number }> = ({ points, focus, fitSeq }) => {
    const map = useMap();

    useEffect(() => {
        if (points.length === 0) return;
        try {
            if (points.length === 1) { map.setView(points[0], 15); return; }
            map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
        } catch { /* حركة خريطة — لا تُسقط الصفحة أبداً */ }
    }, [map, points, fitSeq]);

    useEffect(() => {
        if (!focus) return;
        const p = points[focus.index];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
        // v13.70 — `setView` لا `flyTo`.
        //
        // `flyTo` يحسب مساراً مقوّساً بلوغاريتمات على المسافة بالبكسل بين
        // المركز الحالي والهدف؛ وحين تقترب تلك المسافة من الصفر (أو يكون
        // الإطار مضبوطاً على كامل المملكة بزوم كسري بعد fitBounds) تخرج
        // القسمة **NaN**، فيرمي Leaflet «Invalid LatLng object: (NaN, NaN)»
        // داخل إطار الأنيميشن — **خارج** شجرة React، فيلتقطه ErrorBoundary
        // وتسقط الصفحة كلها. حدث فعلاً عند الضغط على أول اسم في القائمة.
        // `setView` المتحرّك يعطي نفس النتيجة البصرية بحساب مباشر بلا لوغاريتمات.
        try {
            map.setView(p, 16, { animate: true, duration: 0.8 });
        } catch {
            try { map.setView(p, 16, { animate: false }); } catch { /* تجاهل */ }
        }
    }, [map, focus, points]);

    return null;
};

const pinIcon = (n: number, active: boolean) => L.divIcon({
    className: '',
    html: `<div style="
        width:${active ? 36 : 30}px;height:${active ? 36 : 30}px;border-radius:50%;
        background:linear-gradient(135deg,${active ? '#f59e0b,#d97706' : '#0d9488,#0f766e'});
        color:#fff;font-weight:900;font-size:${active ? 16 : 14}px;
        display:flex;align-items:center;justify-content:center;
        border:2.5px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);
        transition:all .2s ease;
    ">${n}</div>`,
    iconSize: active ? [36, 36] : [30, 30],
    iconAnchor: active ? [18, 18] : [15, 15],
    popupAnchor: [0, active ? -19 : -16],
});

const StoreBranchesMap: React.FC<Props> = ({ branches, storeName, isRTL, onClose }) => {
    const pins = useMemo(() => branches
        .map(b => ({ b, c: coordsOf({ lat: b.mapLat, lng: b.mapLng }) }))
        .filter((x): x is { b: StoreBranch; c: { lat: number; lng: number } } => x.c !== null),
        [branches]);

    const points = useMemo(() => pins.map(p => [p.c.lat, p.c.lng] as [number, number]), [pins]);

    const [focus, setFocus] = useState<Focus>(null);
    const [fitSeq, setFitSeq] = useState(0);
    const markerRefs = useRef<Array<L.Marker | null>>([]);

    const focusOn = useCallback((i: number) => {
        setFocus(prev => ({ index: i, seq: (prev?.seq ?? 0) + 1 }));
        // البطاقة تُفتح بعد أن تستقرّ الحركة، وإلا فُتحت خارج الشاشة أثناءها.
        window.setTimeout(() => {
            try { markerRefs.current[i]?.openPopup(); } catch { /* غير قاتل */ }
        }, 850);
    }, []);

    const showAll = useCallback(() => {
        setFocus(null);
        markerRefs.current.forEach(m => { try { m?.closePopup(); } catch { /* غير قاتل */ } });
        setFitSeq(s => s + 1);
    }, []);

    const nameOf = (b: StoreBranch) =>
        (isRTL ? b.nameAr : (b.nameEn || b.nameAr)) || (isRTL ? 'فرع' : 'Branch');

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1400,
                background: 'rgba(0,0,0,0.62)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 'max(env(safe-area-inset-top, 12px), 12px) 12px max(env(safe-area-inset-bottom, 12px), 12px)',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--card-bg)', borderRadius: 20, overflow: 'hidden',
                    width: '100%', maxWidth: 560, maxHeight: '100%',
                    display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--border-color)', boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            📍 {isRTL ? `مواقع ${storeName}` : `${storeName} locations`}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {focus
                                ? (isRTL ? `${nameOf(pins[focus.index].b)} — اضغط الدبّوس للخيارات` : `${nameOf(pins[focus.index].b)} — tap the pin for options`)
                                : (isRTL ? `${pins.length} موقع — اضغط أي اسم للانتقال إليه` : `${pins.length} locations — tap a name to fly there`)}
                        </div>
                    </div>
                    <button onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 12, width: 38, height: 38, fontSize: '1.05rem', fontWeight: 900, cursor: 'pointer', flexShrink: 0 }}>
                        ✕
                    </button>
                </div>

                <div style={{ height: 'min(58vh, 420px)', width: '100%', position: 'relative' }}>
                    <MapContainer center={points[0] || [24.7136, 46.6753]} zoom={13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            subdomains="abc"
                            detectRetina={true}
                            maxZoom={19}
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <MapController points={points} focus={focus} fitSeq={fitSeq} />
                        {pins.map((p, i) => (
                            <Marker
                                key={p.b.id}
                                position={[p.c.lat, p.c.lng]}
                                icon={pinIcon(i + 1, focus?.index === i)}
                                ref={(m) => { markerRefs.current[i] = m; }}
                                eventHandlers={{ click: () => setFocus(prev => ({ index: i, seq: (prev?.seq ?? 0) + 1 })) }}
                            >
                                <Popup>
                                    <div style={{ direction: isRTL ? 'rtl' : 'ltr', minWidth: 168 }}>
                                        <div style={{ fontWeight: 900, fontSize: '0.88rem', marginBottom: 4 }}>
                                            {i + 1}. {nameOf(p.b)}
                                        </div>
                                        {p.b.address && (
                                            <div style={{ fontSize: '0.74rem', opacity: 0.8, marginBottom: 8 }}>{p.b.address}</div>
                                        )}
                                        {/* خياران صريحان (طلب ناصر): يخرج للملاحة، أو يبقى هنا. */}
                                        <a
                                            href={directionsLink({ lat: p.b.mapLat, lng: p.b.mapLng, googleMapsLink: p.b.googleMapsLink })}
                                            target="_blank" rel="noopener noreferrer"
                                            style={{
                                                display: 'block', textAlign: 'center', background: '#0d9488', color: '#fff',
                                                borderRadius: 10, padding: '8px 10px', fontWeight: 900, fontSize: '0.78rem',
                                                textDecoration: 'none', marginBottom: 6,
                                            }}
                                        >
                                            🗺️ {isRTL ? 'فتح في قوقل ماب' : 'Open in Google Maps'}
                                        </a>
                                        <button
                                            onClick={() => markerRefs.current[i]?.closePopup()}
                                            style={{
                                                width: '100%', background: 'transparent', border: '1px solid rgba(120,120,120,0.4)',
                                                borderRadius: 10, padding: '7px 10px', fontWeight: 800, fontSize: '0.76rem',
                                                cursor: 'pointer', marginBottom: 6, color: 'inherit',
                                            }}
                                        >
                                            {isRTL ? 'البقاء هنا' : 'Stay here'}
                                        </button>
                                        {pins.length > 1 && (
                                            <button
                                                onClick={showAll}
                                                style={{
                                                    width: '100%', background: 'transparent', border: 'none',
                                                    padding: 2, fontWeight: 900, fontSize: '0.76rem',
                                                    cursor: 'pointer', color: '#0d9488',
                                                }}
                                            >
                                                ↩︎ {isRTL ? 'عرض كل المواقع' : 'Show all locations'}
                                            </button>
                                        )}
                                    </div>
                                </Popup>
                            </Marker>
                        ))}
                    </MapContainer>

                    {/* زرّ الرجوع للإطار الشامل — فوق الخريطة، ولا يظهر إلا بعد التركيز
                        على موقع واحد. z-index أعلى من طبقات Leaflet (1000). */}
                    {focus && pins.length > 1 && (
                        <button
                            onClick={showAll}
                            style={{
                                position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 1200,
                                background: 'var(--card-bg)', color: 'var(--text-primary)',
                                border: '1px solid var(--border-color)', borderRadius: 999,
                                padding: '9px 14px', fontWeight: 900, fontSize: '0.78rem',
                                cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                            }}
                        >
                            ↩︎ {isRTL ? 'عرض كل المواقع' : 'Show all locations'}
                        </button>
                    )}
                </div>

                {/* القائمة — كل صف زرّ يطير بالخريطة إلى موقعه (طلب ناصر). */}
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
                    {pins.map((p, i) => {
                        const active = focus?.index === i;
                        return (
                            <button
                                key={p.b.id}
                                onClick={() => focusOn(i)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                    background: active ? 'rgba(13,148,136,0.12)' : 'var(--body-bg)',
                                    border: `1px solid ${active ? 'rgba(13,148,136,0.55)' : 'var(--border-color)'}`,
                                    borderRadius: 12, padding: '9px 11px', cursor: 'pointer',
                                    textAlign: isRTL ? 'right' : 'left', color: 'var(--text-primary)',
                                    transition: 'background 0.2s ease, border-color 0.2s ease',
                                }}
                            >
                                <span style={{
                                    flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                                    background: active ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#0d9488,#0f766e)',
                                    color: '#fff', fontWeight: 900, fontSize: '0.74rem',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>{i + 1}</span>
                                <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {nameOf(p.b)}
                                </span>
                                <span aria-hidden style={{ flexShrink: 0, fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)' }}>
                                    {isRTL ? 'اذهب ‹' : '› Go'}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default StoreBranchesMap;
