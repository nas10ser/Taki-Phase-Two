const tryExtract = (text) => {
    if (!text || typeof text !== 'string' || text.length < 5) return null;
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}
    const isValidKSA = (lat, lng) => lat > 15 && lat < 33 && lng > 33 && lng < 56;
    let bestMatch = null;
    const trySet = (latStr, lngStr) => {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isValidKSA(lat, lng)) {
            bestMatch = [null, latStr, lngStr];
            return true;
        }
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

// What if the JSON is exactly this?
const json = '{"status":"success","data":{"image":{"url":"https://maps.google.com/maps/api/staticmap?center=24.7136%2C46.6753"}}}';
console.log("JSON test:", tryExtract(json));

// What if it is a Place ID?
const json2 = '{"data": {"url": "https://www.google.com/maps/place/SomePlaceName/?cid=12345"}}';
console.log("Place ID JSON test:", tryExtract(json2));

