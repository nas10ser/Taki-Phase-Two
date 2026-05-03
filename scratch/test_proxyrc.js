const proxyrc = require('../.proxyrc.js');
const express = require('express');
const app = express();
proxyrc(app);
app.listen(8080, () => {
    console.log("Listening on 8080");
});
