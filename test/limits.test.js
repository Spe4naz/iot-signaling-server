'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-limits-'));

process.env.REGISTER_TOKEN = 'limit-token';
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');
process.env.ALERTS_FILE = path.join(tmp, 'alerts.json');
process.env.RATE_LIMIT_REGISTER = '3';
process.env.RATE_LIMIT_HEARTBEAT = '2';
process.env.RATE_LIMIT_WRITE = '2';
process.env.MAX_DEVICES_PER_IP = '100';

const { createServer } = require('../src/app');

let server;
let base;

before(async () => {
  server = createServer().server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function register(id, ip) {
  return fetch(base + '/api/v1/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer limit-token' },
    body: JSON.stringify({ id, ip }),
  });
}

test('register rate limit trips after N allowed', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    statuses.push((await register(`lim_${i}`, `10.5.5.${i}`)).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test('heartbeat rate limit trips after N allowed', async () => {
  // negative first: heartbeats for an unregistered id return 404 but still consume budget
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    statuses.push(
      (
        await fetch(base + '/api/v1/devices/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'nope_heartbeat' }),
        })
      ).status,
    );
  }
  assert.deepEqual(statuses, [404, 404, 429]);
});