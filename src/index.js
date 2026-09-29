'use strict';

const { createServer } = require('./app');
const config = require('./config');

const API = config.apiPrefix;
const PANEL = config.panel.path;

const PORT = config.server.port;
const HOST = config.server.host;

const app = createServer();
const server = app.server;

server.listen(PORT, HOST, () => {
  console.log(`[signaling] v${config.version} http://${HOST}:${PORT}`);
  console.log(`[signaling] API: ${API}/devices, ${API}/devices/register, ${API}/devices/heartbeat`);
  console.log(`[signaling] Panel: ${PANEL} (${app.settings.panelEnabled() ? 'enabled' : 'disabled — set PANEL_PASSWORD'})`);
  console.log(`[signaling] auth_enabled=${app.settings.apiToken().length > 0}`);
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[signaling] shutting down (${sig})`);
    app.registry.flush();
    app.stability && app.stability.flush();
    app.metrics && app.metrics.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}