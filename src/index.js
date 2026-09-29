'use strict';

const { createServer } = require('./app');
const config = require('./config');

const API = config.apiPrefix;

const PORT = config.server.port;
const HOST = config.server.host;

const { server, registry } = createServer();

server.listen(PORT, HOST, () => {
  console.log(`[signaling] v${config.version} http://${HOST}:${PORT}`);
  console.log(`[signaling] API: ${API}/devices, ${API}/devices/register, ${API}/devices/heartbeat`);
  console.log(`[signaling] auth_enabled=${config.auth.enabled}`);
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