const proxyrc = require('../.proxyrc.js');
const http = require('http');

// Simple connect-like app mock
const app = {
    use: (route, handler) => {
        app.route = route;
        app.handler = handler;
    }
};
proxyrc(app);

const server = http.createServer((req, res) => {
    if (req.url.startsWith(app.route)) {
        app.handler(req, res);
    } else {
        res.end("Not found");
    }
});

server.listen(8080, () => console.log("Listening"));
