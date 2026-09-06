'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-registry-'));
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');
process.env.STALE_MS = '40';
process.env.CLEANUP_INTERVAL_MS = '10000';

const { DeviceRegistry } = require('../src/registry');

function makeRegistry() {
  return new DeviceRegistry();
}

test('register stores valid device with defaults', () => {
  const r = makeRegistry();
  const d = r.register({ id: 'esp32test_01', ip: '192.168.1.50', port: 81, sensors: ['bme680'] });
  assert.ok(d);
  assert.equal(d.id, 'esp32test_01');
  assert.equal(d.ip, '192.168.1.50');
  assert.equal(d.port, 81);
  assert.equal(d.status, 'online');
  assert.deepEqual(d.sensors, ['bme680']);
  assert.equal(d.firstSeen, d.lastSeen);
  assert.ok(r.get('esp32test_01'));
});

test('register dedupes sensors and caps count', () => {
  const r = makeRegistry();
  const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
  const d = r.register({ id: 'd1', ip: '10.0.0.1', sensors: [...many, ...many] });
  assert.equal(d.sensors.length, 64);
  assert.ok(d.sensors[0] === 's0' && d.sensors[63] === 's63');
});

test('register rejects missing id or bad ip', () => {
  const r = makeRegistry();
  assert.equal(r.register({ ip: '1.2.3.4' }), null);
  assert.equal(r.register({ id: 'x', ip: 'not-an-ip' }), null);
  assert.equal(r.register({ id: 'x', ip: '999.1.1.1' }), null);
  assert.equal(r.register({ id: 'x', ip: '' }), null);
});

test('register accepts ipv6 and ipv4-mapped', () => {
  const r = makeRegistry();
  const v6 = r.register({ id: 'v6', ip: 'fe80::1' });
  const v4m = r.register({ id: 'v4m', ip: '::ffff:127.0.0.1' });
  assert.ok(v6 && v4m);
  assert.equal('fe80::1', v6.ip);
});

test('register truncates id/name/type', () => {
  const r = makeRegistry();
  const d = r.register({ id: 'y'.repeat(100), name: 'n'.repeat(200), type: 't'.repeat(100), ip: '1.1.1.1' });
  assert.equal(d.id.length, 64);
  assert.equal(d.name.length, 128);
  assert.equal(d.type.length, 64);
});

test('heartbeat updates status, unknown returns null', () => {
  const r = makeRegistry();
  assert.equal(r.heartbeat('ghost'), null);
  const d = r.register({ id: 'hb', ip: '1.2.3.4' });
  d.status = 'offline';
  r.heartbeat('hb');
  assert.equal(r.get('hb').status, 'online');
  assert.equal(r.get('hb').offlineAt, null);
});

test('cleanup marks stale devices offline but keeps them', () => {
  const r = makeRegistry();
  r.register({ id: 'a', ip: '1.1.1.1' });
  const old = r.register({ id: 'b', ip: '2.2.2.2' });
  old.lastSeen = Date.now() - 10_000;
  r.cleanup();
  assert.equal(r.get('a').status, 'online');
  assert.equal(r.get('b').status, 'offline');
  assert.ok(r.get('b').offlineAt);
  assert.equal(r.get('b') !== null, true);
});

test('list filters by online state and sorts by name', () => {
  const r = makeRegistry();
  r.register({ id: 'b2', name: 'Beta', ip: '1.1.1.1' });
  r.register({ id: 'a1', name: 'Alpha', ip: '2.2.2.2' });
  const c = r.register({ id: 'c3', name: 'Gamma', ip: '3.3.3.3' });
  c.lastSeen = Date.now() - 100_000;
  r.cleanup();
  assert.deepEqual(r.list().map((d) => d.id), ['a1', 'b2', 'c3']);
  assert.deepEqual(r.list({ online: true }).map((d) => d.id), ['a1', 'b2']);
  assert.deepEqual(r.list({ online: false }).map((d) => d.id), ['c3']);
});

test('stats totals online/offline', () => {
  const r = makeRegistry();
  r.register({ id: 'x', ip: '1.1.1.1' });
  const s = r.stats();
  assert.equal(s.total, 1);
  assert.equal(s.online, 1);
  assert.equal(s.offline, 0);
});

test('countByIp', () => {
  const r = makeRegistry();
  r.register({ id: 'ip1', ip: '9.9.9.9' });
  r.register({ id: 'ip2', ip: '9.9.9.9' });
  r.register({ id: 'ip3', ip: '8.8.8.8' });
  assert.equal(r.countByIp('9.9.9.9'), 2);
  assert.equal(r.countByIp('8.8.8.8'), 1);
});

test('remove', () => {
  const r = makeRegistry();
  r.register({ id: 'rm', ip: '1.1.1.1' });
  assert.equal(r.remove('rm'), true);
  assert.equal(r.remove('rm'), false);
  assert.equal(r.get('rm'), null);
});

test('persists to-file and loads back', () => {
  const file = path.join(tmp, 'persist.json');
  process.env.REGISTRY_FILE = file;
  const r1 = makeRegistry();
  r1.register({ id: 'persist', name: 'P', ip: '10.0.0.7' });
  r1.flush();
  const r2 = makeRegistry();
  const d = r2.get('persist');
  assert.ok(d);
  assert.equal(d.name, 'P');
  assert.equal(d.ip, '10.0.0.7');
});