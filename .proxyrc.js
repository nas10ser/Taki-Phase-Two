const resolveMap = require('./api/resolve-map.js');

module.exports = function (app) {
    app.use('/api/resolve-map', async (req, res, next) => {
        req.query = req.query || {};
        const fullUrl = req.originalUrl || req.url;
        if (fullUrl && fullUrl.includes('?')) {
            const qs = new URLSearchParams(fullUrl.split('?')[1]);
            req.query.url = qs.get('url');
        }
        
        res.status = function(code) {
            res.statusCode = code;
            return res;
        };
        
        res.json = function(data) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };
        
        try {
            await resolveMap(req, res);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
};
