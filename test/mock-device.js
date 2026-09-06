'use strict';

/**
 * Mock IoT device for testing the signaling server without ESP32 hardware.
 * Registers itself, sends heartbeats, and simulates a WebSocket endpoint.
 *
 * Usage: node test/mock-device.js [serverUrl] [deviceId]
 *   serverUrl defaults to http://localhost:3000
 */

const http = require('http');

const SERVER = process.argv[2] || process.env.SIGNALING_URL || 'http://localhost:3000';
const DEVICE_ID = process.argv[3] || process.env.MOCK_DEVICE_ID || 'esp32c3_mock_001';

const API = '/api/v1';
const HEARTBEAT_MS = 30_000;
const PORT_HTTP = Number(process.env.MOCK_HTTP_PORT) || 8080;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SERVER + path);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Simulated HTTP API of the mock device itself
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        device_id: DEVICE_ID,
        modules: { BME680_0x76: { temperature: 24.5, humidity: 51.2, pressure: 1012.8, gas_resistance: 72000 } },
        timestamp: Date.now(),
      })
    );
  })
  .listen(PORT_HTTP, () => {
    console.log(`[mock] device API at http://localhost:${PORT_HTTP}/api/v1/sensors`);
  });

async function main() {
  console.log(`[mock] device ${DEVICE_ID} -> signaling ${SERVER}`);

  const info = await post(API + '/devices/register', {
    id: DEVICE_ID,
    name: 'Mock Device',
    type: 'esp32c3',
    ip: '127.0.0.1',
    port: PORT_HTTP,
    sensors: ['temperature', 'humidity', 'pressure', 'gas_resistance'],
  });
  console.log('[mock] register:', JSON.stringify(info));

  setInterval(async () => {
    try {
      const r = await post(API + '/devices/heartbeat', { id: DEVICE_ID });
      console.log(`[mock] heartbeat ok (${new Date().toISOString()})`);
      if (!r.ok) throw new Error(JSON.stringify(r));
    } catch (e) {
      console.error('[mock] heartbeat failed:', e.message);
    }
  }, HEARTBEAT_MS);

  console.log(`[mock] heartbeats every ${HEARTBEAT_MS / 1000}s — Ctrl+C to stop`);
}

main().catch((e) => {
  console.error('[mock] fatal:', e.message);
  process.exit(1);
});