'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-api-'));

process.env.REGISTER_TOKEN = 'test-secret-token';
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');
process.env.ALERTS_FILE = path.join(tmp, 'alerts.json');
process.env.RULES_FILE = path.join(tmp, 'rules.json');
process.env.METRICS_FILE = path.join(tmp, 'metrics.json');
process.env.STABILITY_FILE = path.join(tmp, 'stability.json');
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.METRICS_INTERVAL_MS = '600000';
process.env.METRICS_FLUSH_SECONDS = '600';
process.env.RATE_LIMIT_REGISTER = '100';
process.env.RATE_LIMIT_WRITE = '100';
process.env.RATE_LIMIT_HEARTBEAT = '100';
process.env.MAX_DEVICES_PER_IP = '2';

const { createServer } = require('../src/app');

let server;
let base;
let closed = false;

before(async () => {
  server = createServer().server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (!closed) {
    closed = true;
    server.close();
  }
});

async function req(method, p, { body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json, headers: res.headers };
}

const TOKEN = 'test-secret-token';

test('root returns text banner', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /IoT Modular System/);
});

test('OPTIONS returns CORS preflight 204', async () => {
  const res = await req('OPTIONS', '/api/v1/devices');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('health returns shapes', async () => {
  const r = await req('GET', '/api/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.devices.total, 'number');
  assert.equal(typeof r.json.alerts, 'number');
});

test('meta reports auth enabled', async () => {
  const r = await req('GET', '/api/v1/meta');
  assert.equal(r.status, 200);
  assert.equal(r.json.auth_enabled, true);
  assert.equal(r.json.rate_limits.register, 100);
  assert.equal(r.json.max_devices_per_ip, 2);
});

test('register without token is 401', async () => {
  const r = await req('POST', '/api/v1/devices/register', {
    body: { id: 'noauth', ip: '10.0.0.1' },
  });
  assert.equal(r.status, 401);
});

test('register flow: valid, missing fields, invalid json', async () => {
  const ok = await req('POST', '/api/v1/devices/register', {
    body: { id: 'api_dev1', ip: '10.0.0.2', port: 81 },
    token: TOKEN,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.device.status, 'online');

  const missingIp = await req('POST', '/api/v1/devices/register', {
    body: { id: 'api_dev2' },
    token: TOKEN,
  });
  assert.equal(missingIp.status, 400);

  const badJson = await req('POST', '/api/v1/devices/register', {
    body: 'not json',
    token: TOKEN,
  });
  assert.equal(badJson.status, 400);
});

test('register exceeds max devices per ip with 429', async () => {
  const r1 = await req('POST', '/api/v1/devices/register', {
    body: { id: 'ip_1', ip: '10.0.0.99' },
    token: TOKEN,
  });
  const r2 = await req('POST', '/api/v1/devices/register', {
    body: { id: 'ip_2', ip: '10.0.0.99' },
    token: TOKEN,
  });
  const r3 = await req('POST', '/api/v1/devices/register', {
    body: { id: 'ip_3', ip: '10.0.0.99' },
    token: TOKEN,
  });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 429);
});

test('list and get device require token', async () => {
  const noTokenList = await req('GET', '/api/v1/devices');
  assert.equal(noTokenList.status, 401);
  const noTokenGet = await req('GET', '/api/v1/devices/api_dev1');
  assert.equal(noTokenGet.status, 401);

  const list = await req('GET', '/api/v1/devices', { token: TOKEN });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json));
  assert.ok(list.json.some((d) => d.id === 'api_dev1'));
  const one = await req('GET', '/api/v1/devices/api_dev1', { token: TOKEN });
  assert.equal(one.status, 200);
  assert.equal(one.json.id, 'api_dev1');
  const missing = await req('GET', '/api/v1/devices/nope', { token: TOKEN });
  assert.equal(missing.status, 404);
});

test('heartbeat registered returns 200, unknown 404', async () => {
  const ok = await req('POST', '/api/v1/devices/heartbeat', { body: { id: 'api_dev1' } });
  assert.equal(ok.status, 200);
  const missing = await req('POST', '/api/v1/devices/heartbeat', { body: { id: 'ghost' } });
  assert.equal(missing.status, 404);
});

test('alerts: list, create needs token, update, delete', async () => {
  const noToken = await req('POST', '/api/v1/alerts', {
    body: { device_id: 'api_dev1', sensor_type: 'bme680', type: 'above', threshold: 30 },
  });
  assert.equal(noToken.status, 401);

  const created = await req('POST', '/api/v1/alerts', {
    body: { device_id: 'api_dev1', sensor_type: 'bme680', type: 'above', threshold: 30 },
    token: TOKEN,
  });
  assert.equal(created.status, 200);
  const id = created.json.id;

  const bad = await req('POST', '/api/v1/alerts', {
    body: { device_id: 'api_dev1', sensor_type: 'bme680', type: 'nope', threshold: 30 },
    token: TOKEN,
  });
  assert.equal(bad.status, 400);

  const list = await req('GET', '/api/v1/alerts?device_id=api_dev1');
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);

  const updated = await req('PUT', `/api/v1/alerts/${id}`, {
    body: { threshold: 99 },
    token: TOKEN,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.threshold, 99);

  const del = await req('DELETE', `/api/v1/alerts/${id}`, { token: TOKEN });
  assert.equal(del.status, 200);
  const del2 = await req('DELETE', `/api/v1/alerts/${id}`, { token: TOKEN });
  assert.equal(del2.status, 404);
});

test('delete device removes its alerts', async () => {
  await req('POST', '/api/v1/alerts', {
    body: { device_id: 'api_dev1', sensor_type: 'bme680', type: 'above', threshold: 1 },
    token: TOKEN,
  });
  const del = await req('DELETE', '/api/v1/devices/api_dev1', { token: TOKEN });
  assert.equal(del.status, 200);
  const list = await req('GET', '/api/v1/alerts?device_id=api_dev1');
  assert.equal(list.json.length, 0);
});

test('delete device without token is 401', async () => {
  const r = await req('DELETE', '/api/v1/devices/api_dev1');
  assert.equal(r.status, 401);
});

test('unknown route is 404', async () => {
  const r = await req('GET', '/api/v1/whatever');
  assert.equal(r.status, 404);
});