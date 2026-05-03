// Vercel serverless function: resolve a Google Maps short link (maps.app.goo.gl)
// to its expanded URL on the server, sidestepping browser CORS/CSP that blocks
// public proxies. Returns { url, lat, lng } when extractable.

const tryExtract = (text) => {
    if (!text || typeof text !== 'string') return null;
    
    // Decode URI components where possible to simplify regex matching (%2C -> ,)
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}

    const isValidKSA = (lat, lng) => {
        // Saudi Arabia approximate bounding box
        return lat > 15 && lat < 33 && lng > 33 && lng < 56;
    };

    let bestMatch = null;
    const trySet = (latStr, lngStr) => {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isValidKSA(lat, lng)) {
            bestMatch = { lat, lng };
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
        for (const m of [...decoded.matchAll(new RegExp(p.source, 'gi'))]) if (trySet(m[1], m[2])) return bestMatch;
    }

    const lat3d = text.match(/!3d(-?\d+\.\d+)/) || decoded.match(/!3d(-?\d+\.\d+)/);
    const lng2d = text.match(/!(?:2d|4d)(-?\d+\.\d+)/) || decoded.match(/!(?:2d|4d)(-?\d+\.\d+)/);
    if (lat3d && lng2d && trySet(lat3d[1], lng2d[1])) return bestMatch;

    const brute = [...text.matchAll(/(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/g), ...decoded.matchAll(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g)];
    for (const b of brute) {
        if (trySet(b[1], b[2])) return bestMatch;
    }
    
    return null;
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    // Enable CORS for API
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const target = (req.query && req.query.url) || '';
    if (!target || !/^https?:\/\//i.test(target)) {
        return res.status(400).json({ error: 'missing url' });
    }

    try {
        let current = target;
        let html = '';
        let coords = tryExtract(current);

        // Max 6 redirects/fetches
        for (let i = 0; i < 6 && !coords; i++) {
            // Using WhatsApp User-Agent tricks Google Maps into returning OpenGraph meta tags
            // instead of a complex JS app or an interstitial consent page. This makes it
            // work exactly like when pasting the link into WhatsApp.
            const resp = await fetch(current, {
                redirect: 'manual',
                headers: { 
                    'User-Agent': 'WhatsApp/2.21.12.21 A',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            
            const loc = resp.headers.get('location');
            if (loc) {
                current = loc.startsWith('http') ? loc : new URL(loc, current).toString();
                coords = tryExtract(current);
                continue;
            }
            
            html = await resp.text().catch(() => '');
            
            // Check for meta refresh redirect
            const metaRefresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=([^"']+)["']?/i);
            if (metaRefresh && metaRefresh[1]) {
                const nextLoc = metaRefresh[1].replace(/&amp;/g, '&');
                current = nextLoc.startsWith('http') ? nextLoc : new URL(nextLoc, current).toString();
                coords = tryExtract(current);
                continue;
            }

            coords = tryExtract(current) || tryExtract(html);
            break;
        }

        // Fallback: Geocode title if no coords found
        if (!coords && html) {
            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
            let placeName = titleMatch && titleMatch[1]
                .replace(/\s*[-|·]\s*Google Maps.*$/i, '')
                .replace(/^Google Maps[:\s-]*/i, '')
                .trim();
            
            if (placeName && placeName.length > 3 && placeName !== 'Google Maps') {
                const geo = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&countrycodes=sa&limit=1`,
                    { headers: { 'User-Agent': 'TakiApp/1.0' } }
                ).then(r => r.json()).catch(() => null);
                
                if (geo && geo[0]) coords = { lat: parseFloat(geo[0].lat), lng: parseFloat(geo[0].lon) };
            }
        }

        if (coords) {
            res.status(200).json({ url: current, lat: coords.lat, lng: coords.lng });
        } else {
            res.status(200).json({ url: current, lat: null, lng: null });
        }
    } catch (e) {
        res.status(500).json({ error: e && e.message ? e.message : 'server error' });
    }
};

