import React from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { TAKI_TILE_URL, TAKI_TILE_ATTRIBUTION, TAKI_TILE_MAX_ZOOM } from '../../utils/leafletSetup';
import MapAutoResize from '../MapAutoResize';

/**
 * StoreLocationPicker — خريطة اختيار موقع المحلّ (v14.84)
 * ═══════════════════════════════════════════════════════════════════════════
 * اُستُخرجت من `SellerDashboard.tsx` حرفاً بحرف. سببان مقيسان:
 *   ١) الملفّ كان ٥٧٥٨ سطراً — لا يُقرأ في جلسة واحدة، وهو أعلى مصدرٍ لكسر
 *      ميزةٍ أثناء إصلاح أخرى.
 *   ٢) و`react-leaflet` كان مستورَداً **ساكناً** في اللوحة، فيدخل حزمتَها
 *      وإن لم يفتح التاجرُ الخريطة قطّ. هنا يدخل حزمةَ هذا المكوّن وحده.
 *
 * 🪤 ولا تغيير سلوكيّ إطلاقاً: المنطق منقولٌ كما هو، بما فيه علاجُ v14.63
 *    (الكاميرا لا تُعاد إلا من مصدرٍ خارج الخريطة عبر `nonce`) — وهو ما جعل
 *    «الخريطة معلّقة» تختفي، فأيّ مسٍّ به يُعيد ذلك العطل.
 */

const LocationMarker = ({ position, autoUpdate }: { position: [number, number], autoUpdate: (lat: number, lng: number, fromMap?: boolean) => void }) => {
    useMapEvents({
        // `fromMap: true` — انظر MapCenterUpdater: نقرةٌ على الخريطة يجب ألّا
        // تُعيد ضبط الكاميرا، وإلا قاومت الخريطةُ التاجرَ في كل لمسة.
        click(e) {
            autoUpdate(e.latlng.lat, e.latlng.lng, true);
        },
    });
    return position ? (
        <Marker 
            position={position} 
            draggable={true} 
            eventHandlers={{
                dragend: (e) => {
                    const markerOrigin = e.target.getLatLng();
                    autoUpdate(markerOrigin.lat, markerOrigin.lng, true);
                }
            }} 
        />
    ) : null;
};

/**
 * v14.63 — 🔴 كانت تعيد ضبط التكبير إلى ١٥ وتعيد التوسيط **في كل نقرة وكل
 * سحبٍ للدبّوس**، لأن `mapPos` تتغيّر من داخل الخريطة نفسها. فالتاجر الذي
 * يُكبّر إلى ١٨ ليضع الدبّوس بدقّة يُقذف إلى ١٥ فور لمسه، ثم تُعاد الكرّة بعد
 * ٣٠٠ms. هذا هو «الخريطة معلّقة» في شاشة إضافة المنتج.
 *
 * الآن: الكاميرا تتحرّك **فقط** حين يأتي الموقع من خارج الخريطة (رابط ملصوق،
 * اختيار مدينة، زرّ «موقعي») — عبر `nonce` يزيد هناك وحده — وتُحترم درجة
 * تكبير المستخدم إن كان أقرب من ١٥.
 */
const MapCenterUpdater = ({ center, nonce }: { center: [number, number]; nonce: number }) => {
    const map = useMap();
    const centerRef = React.useRef(center);
    centerRef.current = center;
    React.useEffect(() => {
        const center = centerRef.current;
        if (!center[0] || !center[1]) return;
        // Three-phase pan. Earlier versions did a single setTimeout(0)
        // pan-with-animation which silently failed on iOS Safari when the
        // success modal opened over the map: the alert's enter-animation
        // briefly redrew the layer above the map, Leaflet's `invalidateSize`
        // measured the wrong tile grid, and `setView` with `animate: true`
        // never finished. The pin moved in state but the map stayed at
        // Riyadh — exactly what Nasser saw with the Sakaka link.
        //
        // Fix:
        //   1. Pan IMMEDIATELY with `animate: false` so the camera is
        //      already on-target before any modal can interfere.
        //   2. Re-issue `invalidateSize + setView` after 300ms so that if
        //      the container was 0-height during phase 1 (e.g. parent
        //      animating in, modal closing), the second pass lands on the
        //      correct tile grid.
        //   3. Use try/catch — Leaflet throws if the map was just torn
        //      down (rare, but happens during fast view switches).
        let z = 15;
        try { z = Math.max(map.getZoom() || 15, 15); } catch { /* mid-teardown */ }
        try {
            map.setView(center, z, { animate: false });
        } catch { /* map may be mid-teardown; phase 2 covers it */ }

        const t = setTimeout(() => {
            try {
                map.invalidateSize();
                map.setView(centerRef.current, map.getZoom(), { animate: false });
            } catch { /* swallow — best-effort */ }
        }, 300);
        return () => clearTimeout(t);
         
    }, [nonce, map]);
    return null;
};

const StoreLocationPicker: React.FC<{
    pos: [number, number];
    nonce: number;
    onPick: (lat: number, lng: number, fromMap?: boolean) => void;
}> = ({ pos, nonce, onPick }) => (
    /* attributionControl=false drops the default Leaflet badge, which includes
       a Ukraine flag glyph baked into the library's prefix string. We don't need
       the badge here — the map is a picker, not a publishing surface. */
    <MapContainer center={pos} zoom={13} style={{ height: '100%', width: '100%' }}>
        <MapAutoResize />
        <TileLayer url={TAKI_TILE_URL} maxZoom={TAKI_TILE_MAX_ZOOM} attribution={TAKI_TILE_ATTRIBUTION} />
        <MapCenterUpdater center={pos} nonce={nonce} />
        <LocationMarker position={pos} autoUpdate={onPick} />
    </MapContainer>
);

export default StoreLocationPicker;
