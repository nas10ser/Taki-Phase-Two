import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { StoreBranch } from '../repositories/branchRepository';
import { coordsOf, directionsLink } from '../utils/mapLinks';

/**
 * StoreBranchesMap — «اعرض كل المواقع على الخريطة» (v13.66)
 *
 * ما كان يحدث قبلها: الزرّ يفتح **بحثاً في قوقل باسم المتجر**، فلا علاقة لما
 * يظهر بفروع المتجر إطلاقاً (بلاغ ناصر: «لا يعرضلي الثلاث الظاهرة بالأعلى»).
 * الآن خريطة داخل التطبيق تعرض نفس الفروع المعروضة في البطاقة، كلٌّ بدبّوسه
 * المرقّم وإحداثيّه الحقيقي، والإطار يضبط نفسه ليضمّها جميعاً.
 *
 * الدبابيس `divIcon` (HTML) لا صور: لا ملف أيقونة يُحمَّل، والرقم يطابق ترتيب
 * الفرع في القائمة أعلاه فيربط المستخدم بينهما بنظرة.
 */

interface Props {
    branches: StoreBranch[];
    storeName: string;
    isRTL: boolean;
    onClose: () => void;
}

/** يضبط إطار الخريطة ليضمّ كل الدبابيس (أو يتمركز على واحد). */
const FitPins: React.FC<{ points: [number, number][] }> = ({ points }) => {
    const map = useMap();
    React.useEffect(() => {
        if (points.length === 0) return;
        if (points.length === 1) { map.setView(points[0], 15); return; }
        map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
    }, [map, points]);
    return null;
};

const pinIcon = (n: number) => L.divIcon({
    className: '',
    html: `<div style="
        width:30px;height:30px;border-radius:50%;
        background:linear-gradient(135deg,#0d9488,#0f766e);
        color:#fff;font-weight:900;font-size:14px;
        display:flex;align-items:center;justify-content:center;
        border:2.5px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);
    ">${n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
});

const StoreBranchesMap: React.FC<Props> = ({ branches, storeName, isRTL, onClose }) => {
    const pins = useMemo(() => branches
        .map(b => ({ b, c: coordsOf({ lat: b.mapLat, lng: b.mapLng }) }))
        .filter((x): x is { b: StoreBranch; c: { lat: number; lng: number } } => x.c !== null),
        [branches]);

    const points = useMemo(() => pins.map(p => [p.c.lat, p.c.lng] as [number, number]), [pins]);

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
                            {isRTL ? `${pins.length} موقع على الخريطة` : `${pins.length} locations on the map`}
                        </div>
                    </div>
                    <button onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 12, width: 38, height: 38, fontSize: '1.05rem', fontWeight: 900, cursor: 'pointer', flexShrink: 0 }}>
                        ✕
                    </button>
                </div>

                <div style={{ height: 'min(60vh, 430px)', width: '100%' }}>
                    <MapContainer center={points[0] || [24.7136, 46.6753]} zoom={13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            subdomains="abc"
                            detectRetina={true}
                            maxZoom={19}
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <FitPins points={points} />
                        {pins.map((p, i) => (
                            <Marker key={p.b.id} position={[p.c.lat, p.c.lng]} icon={pinIcon(i + 1)}>
                                <Popup>
                                    <div style={{ fontWeight: 900, fontSize: '0.85rem', marginBottom: 4, direction: isRTL ? 'rtl' : 'ltr' }}>
                                        {(isRTL ? p.b.nameAr : (p.b.nameEn || p.b.nameAr)) || (isRTL ? 'فرع' : 'Branch')}
                                    </div>
                                    {p.b.address && (
                                        <div style={{ fontSize: '0.74rem', opacity: 0.8, marginBottom: 6, direction: isRTL ? 'rtl' : 'ltr' }}>{p.b.address}</div>
                                    )}
                                    <a
                                        href={directionsLink({ lat: p.b.mapLat, lng: p.b.mapLng, googleMapsLink: p.b.googleMapsLink })}
                                        target="_blank" rel="noopener noreferrer"
                                        style={{ fontWeight: 800, fontSize: '0.76rem' }}
                                    >
                                        🗺️ {isRTL ? 'الاتجاهات' : 'Directions'}
                                    </a>
                                </Popup>
                            </Marker>
                        ))}
                    </MapContainer>
                </div>

                {/* قائمة مختصرة تحت الخريطة — الرقم هنا هو رقم الدبّوس نفسه. */}
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
                    {pins.map((p, i) => (
                        <div key={p.b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#0d9488,#0f766e)', color: '#fff', fontWeight: 900, fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                            <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {(isRTL ? p.b.nameAr : (p.b.nameEn || p.b.nameAr)) || (isRTL ? 'فرع' : 'Branch')}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default StoreBranchesMap;
