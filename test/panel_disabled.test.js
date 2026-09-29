'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-paneld-'));
process.env.REGISTER_TOKEN = '';
process.env.PANEL_PASSWORD = ''; // panel disabled
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');
process.env.ALERTS_FILE = path.join(tmp, 'alerts.json');
process.env.RULES_FILE = path.join(tmp, 'rules.json');
process.env.METRICS_FILE = path.join(tmp, 'metrics.json');
process.env.STABILITY_FILE = path.join(tmp, 'stability.json');
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');

const { createServer } = require('../src/app');

let server;
let base;

before(async () => {
  server = createServer().server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('disabled panel: session and login return 503', async () => {
  const sessionRes = await fetch(base + '/panel/api/session');
  assert.equal(sessionRes.status, 503);

  const loginRes = await fetch(base + '/panel/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x' }),
  });
  assert.equal(loginRes.status, 503);
});

test('disabled panel: root banner still advertises the panel path', async () => {
  const res = await fetch(base + '/');
  const text = await res.text();
  assert.match(text, /Panel: \/panel/);
});