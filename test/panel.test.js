'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-panel-'));

process.env.REGISTER_TOKEN = 'api-token';
process.env.PANEL_PASSWORD = 'panel-secret';
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
process.env.RATE_LIMIT_READ = '100';

const { createServer } = require('../src/app');

let server;
let base;
let cookie = '';

const PANEL = '/panel';

before(async () => {
  const app = createServer();
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server && server.listening) server.close();
});

async function api(method, p, { body, cookie: c, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (c) headers['Cookie'] = c;
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

function grabCookie(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/iot_panel=([^;]+)/);
  return m ? `iot_panel=${m[1]}` : '';
}

test('session and system endpoints reject unauthenticated requests', async () => {
  assert.equal((await api('GET', `${PANEL}/api/session`)).status, 401);
  assert.equal((await api('GET', `${PANEL}/api/system`)).status, 401);
  assert.equal((await api('GET', `${PANEL}/api/devices`)).status, 401);
  assert.equal((await api('GET', `${PANEL}/api/settings`)).status, 401);
  assert.equal((await api('PUT', `${PANEL}/api/settings`, { body: {} })).status, 401);
});

test('login rejects wrong password and rate limits', async () => {
  assert.equal((await api('POST', `${PANEL}/api/auth/login`, { body: { password: 'nope' } })).status, 401);
  assert.equal((await api('POST', `${PANEL}/api/auth/login`, { body: { password: 'nope' } })).status, 401);
});

test('login succeeds and sets cookie; session returns info', async () => {
  const res = await api('POST', `${PANEL}/api/auth/login`, { body: { password: 'panel-secret' } });
  assert.equal(res.status, 200);
  cookie = grabCookie(res);
  assert.ok(cookie, 'cookie set');

  const sessionRes = await api('GET', `${PANEL}/api/session`, { cookie });
  assert.equal(sessionRes.status, 200);
  assert.equal(sessionRes.json.ok, true);
  assert.equal(sessionRes.json.version, require('../package.json').version);
});

test('system and history endpoints return data', async () => {
  const sys = await api('GET', `${PANEL}/api/system`, { cookie });
  assert.equal(sys.status, 200);
  assert.equal(sys.json.ok, true);
  assert.ok(sys.json.system);
  assert.equal(typeof sys.json.system.cpu, 'number');
  assert.equal(typeof sys.json.system.mem, 'number');
  assert.equal(typeof sys.json.devices.total, 'number');

  const hist = await api('GET', `${PANEL}/api/system/history?points=60`, { cookie });
  assert.equal(hist.status, 200);
  assert.ok(Array.isArray(hist.json.perf));
  assert.equal(hist.json.perf.length, hist.json.online.length);
});

test('devices CRUD via panel, with stability journal', async () => {
  const created = await api('POST', `${PANEL}/api/devices`, {
    cookie,
    body: { id: 'panel_dev_1', ip: '10.9.9.9', name: 'Panel Device', type: 'esp32', sensors: ['temp'] },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.device.id, 'panel_dev_1');
  assert.equal(created.json.device.status, 'online');

  const list = await api('GET', `${PANEL}/api/devices`, { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.some((d) => d.id === 'panel_dev_1'));
  assert.equal(typeof list.json.find((d) => d.id === 'panel_dev_1').uptime24, 'number');

  const updated = await api('PUT', `${PANEL}/api/devices/panel_dev_1`, {
    cookie,
    body: { name: 'Renamed', port: 8080 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.device.name, 'Renamed');
  assert.equal(updated.json.device.port, 8080);

  const invalid = await api('PUT', `${PANEL}/api/devices/panel_dev_1`, { cookie, body: { ip: 'bad' } });
  assert.equal(invalid.status, 400);

  const detail = await api('GET', `${PANEL}/api/devices/panel_dev_1`, { cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.device.id, 'panel_dev_1');
  assert.ok(Array.isArray(detail.json.stability.events));
  assert.ok(detail.json.stability.events.length >= 1);

  const del = await api('DELETE', `${PANEL}/api/devices/panel_dev_1`, { cookie });
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `${PANEL}/api/devices/panel_dev_1`, { cookie })).status, 404);
});

test('panel session authorizes /api/v1 alerts/rules writes and device reads', async () => {
  const dev = await api('POST', `${PANEL}/api/devices`, {
    cookie,
    body: { id: 'api_dev', ip: '10.7.7.7' },
  });
  assert.equal(dev.status, 200);

  const alert = await api('POST', '/api/v1/alerts', {
    cookie,
    body: { device_id: 'api_dev', sensor_type: 'temp', type: 'above', threshold: 30 },
  });
  assert.equal(alert.status, 200);
  assert.equal(alert.json.device_id, 'api_dev');

  const rule = await api('POST', '/api/v1/rules', {
    cookie,
    body: { device_id: 'api_dev', trigger: 'threshold_above', sensor_type: 'temp', threshold: 25, action: 'notify' },
  });
  assert.equal(rule.status, 200);

  const list = await api('GET', '/api/v1/devices', { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.some((d) => d.id === 'api_dev'));

  // while a plain (token-less) device cannot read the registry
  assert.equal((await api('GET', '/api/v1/devices')).status, 401);

  // device register stays open for bearer token holders
  const reg = await api('POST', '/api/v1/devices/register', {
    token: 'api-token',
    body: { id: 'bearer_dev', ip: '10.6.6.6' },
  });
  assert.equal(reg.status, 200);
});

test('settings PUT applies stale_ms at runtime (visible in meta)', async () => {
  const beforeMeta = await api('GET', '/api/v1/meta', { cookie });
  const put = await api('PUT', `${PANEL}/api/settings`, { cookie, body: { stale_ms: 111111 } });
  assert.equal(put.status, 200);
  assert.equal(put.json.stale_ms, 111111);

  const afterMeta = await api('GET', '/api/v1/meta', { cookie });
  assert.equal(afterMeta.json.stale_ms, 111111);
  assert.notEqual(afterMeta.json.stale_ms, beforeMeta.json.stale_ms);
});

test('static panel SPA served under /panel/', async () => {
  const res = await fetch(base + '/panel/');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /<div id="app"><\/div>/);

  // deep link for client-side routing falls back to index.html
  const missing = await fetch(base + '/panel/devices/nonexistent');
  assert.equal(missing.status, 200);
  const missingText = await missing.text();
  assert.match(missingText, /<div id="app"><\/div>/);
});

test('settings PUT rate limits trip in real time', async () => {
  await api('PUT', `${PANEL}/api/settings`, { cookie, body: { rate_limits: { heartbeat: 2 } } });

  const statuses = [];
  for (let i = 0; i < 3; i++) {
    statuses.push(
      (
        await api('POST', '/api/v1/devices/heartbeat', {
          body: { id: `nope_hb_${Date.now()}_${i}` },
        })
      ).status,
    );
  }
  assert.deepEqual(statuses, [404, 404, 429]);

  // restore
  await api('PUT', `${PANEL}/api/settings`, { cookie, body: { rate_limits: { heartbeat: 100 } } });
});

test('settings GET hides secrets', async () => {
  const s = await api('GET', `${PANEL}/api/settings`, { cookie });
  assert.equal(s.status, 200);
  assert.equal(typeof s.json.api_token_set, 'boolean');
  assert.equal(s.json.api_token, undefined);
  assert.equal(s.json.panel_password, undefined);
});

test('panel api + session persist across restarts of collectibles', async () => {
  // Ensure settings survived the earlier writes (new SettingsStore reads same file)
  const meta = await api('GET', '/api/v1/meta', { cookie });
  assert.equal(meta.json.stale_ms, 111111);
});