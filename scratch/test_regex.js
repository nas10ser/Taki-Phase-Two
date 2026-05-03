const tryExtract = (text) => {
    if (!text || typeof text !== 'string') return null;
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}
    const isValidKSA = (lat, lng) => lat > 15 && lat < 33 && lng > 33 && lng < 56;
    let bestMatch = null;
    const trySet = (latStr, lngStr) => {
        const lat = parseFloat(latStr); const lng = parseFloat(lngStr);
        if (isValidKSA(lat, lng)) { bestMatch = [null, latStr, lngStr]; return true; }
        return false;
    };
    const patterns = [
        /@(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi,
        /[?&](?:q|ll|query|center|markers|latlng|daddr|destination)=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi
    ];
    for (const p of patterns) {
        for (const m of [...text.matchAll(p)]) if (trySet(m[1], m[2])) return bestMatch;
        const pNoG = new RegExp(p.source, 'gi');
        for (const m of [...decoded.matchAll(pNoG)]) if (trySet(m[1], m[2])) return bestMatch;
    }
    const latM1 = text.match(/!3d(-?\d+\.\d+)/) || decoded.match(/!3d(-?\d+\.\d+)/);
    const lngM1 = text.match(/!(?:2d|4d)(-?\d+\.\d+)/) || decoded.match(/!(?:2d|4d)(-?\d+\.\d+)/);
    if (latM1 && lngM1 && trySet(latM1[1], lngM1[1])) return bestMatch;
    const brute = [...text.matchAll(/(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/g), ...decoded.matchAll(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g)];
    for (const b of brute) if (trySet(b[1], b[2])) return bestMatch;
    return null;
};

// Mock OpenGraph HTML from WhatsApp User-Agent fetch
const mockHtml = `<html><head>
<meta property="al:android:url" content="android-app://com.google.android.apps.maps/geo/0,0?q=24.7136%2C46.6753">
<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=24.7136%2C46.6753&zoom=17">
<meta property="og:url" content="https://maps.app.goo.gl/1234">
</head><body></body></html>`;

console.log("Mock HTML result:", tryExtract(mockHtml));

// Wait! What if the URL is directly passed?
console.log("Mock URL result:", tryExtract("https://maps.google.com/maps/api/staticmap?center=24.7136%2C46.6753"));

// What if it is a Place ID?
console.log("Place ID result:", tryExtract("https://www.google.com/maps/place/Al+Faisaliah+Tower/@24.6904677,46.6845332,17z"));

