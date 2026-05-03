const https = require('https');
https.get('https://api.microlink.io/?url=' + encodeURIComponent('https://maps.app.goo.gl/9SAHH2t8aCYJ3xBo9?g_st=ic'), (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => console.log(data));
}).on('error', e => console.error(e.message));
