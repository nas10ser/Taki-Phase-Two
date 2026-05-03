const net = require('net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  console.log('Server listening on:', server.address());
  server.close();
});
server.on('error', (err) => {
  console.error('Error:', err);
});
