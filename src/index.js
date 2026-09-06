'use strict';

const { createServer } = require('./app');

const VERSION = require('../package.json').version;
const API = '/api/v1';

const PORT = Number(process.env.PORT) || 3000;
// Bind to loopback by default — public access goes through nginx (TLS/rate rules).
// Override with HOST=0.0.0.0 only for explicit publishing.
const HOST = process.env.HOST || '127.0.0.1';

const { server, registry } = createServer();

server.listen(PORT, HOST, () => {
  console.log(`[signaling] v${VERSION} http://${HOST}:${PORT}`);
  console.log(`[signaling] API: ${API}/devices, ${API}/devices/register, ${API}/devices/heartbeat`);
  console.log(`[signaling] auth_enabled=${Boolean(process.env.REGISTER_TOKEN)}`);
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[signaling] shutting down');
    registry.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}