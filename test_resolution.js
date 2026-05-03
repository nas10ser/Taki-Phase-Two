const https = require('https');

const googleMapsLink = "https://maps.app.goo.gl/9SAHH2t8aCYJ3xBo9?g_st=ic";

const tryExtract = (text) => {
    if (!text || typeof text !== 'string' || text.length < 5) return null;
    
    let m = text.match(/@(-?\d+\.\d+)\s*[,|%2C]\s*(-?\d+\.\d+)/i) ||
            text.match(/[?&](?:q|ll|query|center|markers|latlng|daddr)=(-?\d+\.\d+)\s*[,|%2C]\s*(-?\d+\.\d+)/i);
    
    if (!m) {
        const latM = text.match(/!3d(-?\d+\.\d+)/);
        const lngM = text.match(/!(?:2d|4d)(-?\d+\.\d+)/);
        if (latM && lngM) m = [null, latM[1], lngM[1]];
    }

    if (!m) {
        const brute = text.matchAll(/(-?\d+\.\d+)\s*[,|%2C]\s*(-?\d+\.\d+)/g);
        for (const b of brute) {
            const lat = parseFloat(b[1]);
            const lng = parseFloat(b[2]);
            if (lat > 15 && lat < 33 && lng > 33 && lng < 56) {
                return b;
            }
        }
    }
    return m;
};

const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(googleMapsLink)}`;

https.get(proxy, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Status URL:', json.status?.url);
            let match = tryExtract(json.status?.url);
            if (!match && json.contents) {
                match = tryExtract(json.contents);
            }
            
            if (match) {
                console.log('SUCCESS:', match[1], match[2]);
            } else {
                console.log('FAILED');
            }
        } catch (e) {
            console.log('PARSE ERROR:', e.message);
        }
    });
}).on('error', (e) => {
    console.log('FETCH ERROR:', e.message);
});
