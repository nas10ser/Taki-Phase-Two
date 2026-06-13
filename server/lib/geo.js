/**
 * lib/geo.js — مسافات، روابط/إحداثيات قوقل ماب، حساب الوقت/المسافة بالسيارة،
 * وحساب المتبقّي زمنياً للعروض. أدوات نقيّة مستخرَجة من bot.js v11.72.
 */

function haversineKm(la1, lo1, la2, lo2) {
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180,
        a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const fmtKm = km => km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;

// تحليل "lat,lng" مكتوبة مباشرة.
function parseLatLng(text) {
    const m = String(text).match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (m) { const la = +m[1], ln = +m[2]; if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) return { lat: la, lng: ln }; }
    return null;
}
// استخراج إحداثيات من رابط قوقل ماب (عدة أنماط).
function extractFromMapsUrl(url) {
    try {
        const u = decodeURIComponent(String(url));
        let m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);                                  if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/[?&](?:q|query|destination|center|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);  if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);                                  if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})/);                          if (m) return { lat: +m[1], lng: +m[2] };
    } catch { /* ignore */ }
    return null;
}
// يقبل إحداثيات مباشرة، رابط ماب كامل، أو رابط قصير (يتبعه ويحلّله).
async function resolveGoogleLocation(text) {
    const t = String(text || '').trim();
    const direct = parseLatLng(t);       if (direct) return direct;
    const inUrl  = extractFromMapsUrl(t); if (inUrl) return inUrl;
    if (/^https?:\/\//i.test(t)) {
        try {
            const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 5000);
            const r = await fetch(t, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(to);
            const fromFinal = extractFromMapsUrl(r.url || t); if (fromFinal) return fromFinal;
            const body = await r.text().catch(() => '');
            const fromBody = extractFromMapsUrl(body); if (fromBody) return fromBody;
        } catch { /* network/timeout → give up */ }
    }
    return null;
}

// رابط مكان قوقل (فتح موقع العرض). يقبل صف عرض أو {map_lat,map_lng,google_maps_link}.
function placeLink(d) {
    if (d.map_lat != null && d.map_lng != null) return `https://www.google.com/maps/search/?api=1&query=${d.map_lat},${d.map_lng}`;
    return d.google_maps_link || null;
}
// رابط اتجاهات قيادة قوقل (ملاحة فعلية عند الفتح).
function dirLink(d, geo) {
    if (d.map_lat == null || d.map_lng == null) return d.google_maps_link || null;
    const org = geo ? `&origin=${geo.lat},${geo.lng}` : '';
    return `https://www.google.com/maps/dir/?api=1${org}&destination=${d.map_lat},${d.map_lng}&travelmode=driving`;
}
// مسافة/وقت طريق فعلي عبر OSRM (ميزانية 2.5s) مع تقدير خطّي احتياطي.
async function driveInfo(geo, d) {
    if (!geo || d.map_lat == null || d.map_lng == null) return null;
    const straight = haversineKm(geo.lat, geo.lng, d.map_lat, d.map_lng);
    try {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${geo.lng},${geo.lat};${d.map_lng},${d.map_lat}?overview=false`, { signal: ctrl.signal });
        clearTimeout(to); const j = await r.json(); const rt = j && j.routes && j.routes[0];
        if (rt) return { km: rt.distance / 1000, min: Math.max(1, Math.round(rt.duration / 60)), straight, est: false };
    } catch { /* OSRM down / slow → estimate */ }
    const km = straight * 1.3; return { km, min: Math.max(1, Math.round(km / 0.6)), straight, est: true };
}

// المتبقّي زمنياً لعرض مدّة/ساعات (يبدأ العدّ عند انطلاقه).
function remainingText(d) {
    if (!d.expires_in_minutes) return null;
    const start = Math.max(Number(d.starts_at) || 0, Number(d.created_at) || 0);
    let diff = start + d.expires_in_minutes * 60000 - Date.now();
    if (diff <= 0) return null;
    const day = Math.floor(diff / 86400000); diff -= day * 86400000;
    const hr = Math.floor(diff / 3600000); diff -= hr * 3600000;
    const mn = Math.floor(diff / 60000);
    if (day > 0) return `${day} يوم${hr ? ` و${hr} ساعة` : ''}`;
    if (hr > 0)  return `${hr} ساعة${mn ? ` و${mn} دقيقة` : ''}`;
    return `${mn} دقيقة`;
}
// لحظة الانتهاء الدقيقة لعرض مدّة (لعرض التاريخ+الوقت الحقيقي للانتهاء).
function durationEndsAt(d) {
    if (!d.expires_in_minutes) return null;
    const start = Math.max(Number(d.starts_at) || 0, Number(d.created_at) || 0);
    if (!start) return null;
    return start + d.expires_in_minutes * 60000;
}

module.exports = {
    haversineKm, fmtKm, parseLatLng, extractFromMapsUrl, resolveGoogleLocation,
    placeLink, dirLink, driveInfo, remainingText, durationEndsAt,
};
