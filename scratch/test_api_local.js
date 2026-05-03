const http = require('http');
http.get('http://127.0.0.1:1234/api/resolve-map?url=http://google.com', (res) => {
    console.log(res.statusCode);
}).on('error', (e) => console.log(e.message));
