const net = require('net');
const server = net.createServer();
server.on('error', (err) => {
  console.error('Server error:', err);
});
server.listen(3000, '127.0.0.1', () => {
  console.log('Server listening on 127.0.0.1:3000');
  server.close();
});
