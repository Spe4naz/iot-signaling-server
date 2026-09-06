'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-alerts-'));

const { AlertStore } = require('../src/alerts');

let seq = 0;
function makeStore() {
  process.env.ALERTS_FILE = path.join(tmp, `alerts-${seq++}.json`);
  return new AlertStore();
}

test('create returns normalized alert with id', () => {
  const s = makeStore();
  const a = s.create({ device_id: 'dev1', sensor_type: 'bme680', type: 'above', threshold: 30 });
  assert.ok(a.id);
  assert.ok(a.created_at);
  assert.equal(a.is_active, true);
  assert.equal(a.device_id, 'dev1');
  assert.equal(a.type, 'above');
});

test('create rejects invalid payloads', () => {
  const s = makeStore();
  assert.equal(s.create({}), null);
  assert.equal(s.create({ device_id: 'd', sensor_type: 's', type: 'weird', threshold: 1 }), null);
  assert.equal(s.create({ device_id: '', sensor_type: 's', type: 'above', threshold: 1 }), null);
  assert.equal(s.create({ device_id: 'd', sensor_type: '', type: 'above', threshold: 1 }), null);
  assert.equal(s.create({ device_id: 'd', sensor_type: 's', type: 'above', threshold: 'nan' }), null);
});

test('create honors is_active false', () => {
  const s = makeStore();
  const a = s.create({ device_id: 'd', sensor_type: 's', type: 'below', threshold: 5, is_active: false });
  assert.equal(a.is_active, false);
});

test('update merges fields, preserves id and created_at', () => {
  const s = makeStore();
  const a = s.create({ device_id: 'd', sensor_type: 's', type: 'above', threshold: 10 });
  const u = s.update(a.id, { threshold: 42, is_active: false });
  assert.ok(u);
  assert.equal(u.threshold, 42);
  assert.equal(u.is_active, false);
  assert.equal(u.id, a.id);
  assert.equal(u.created_at, a.created_at);
  assert.equal(u.device_id, 'd');
});

test('update on missing id returns null; invalid update returns null', () => {
  const s = makeStore();
  const a = s.create({ device_id: 'd', sensor_type: 's', type: 'above', threshold: 1 });
  assert.equal(s.update('nope', { threshold: 5 }), null);
  assert.equal(s.update(a.id, { type: 'bogus' }), null);
});

test('list filters by device and sorts newest first', async () => {
  const s = makeStore();
  const a1 = s.create({ device_id: 'devX', sensor_type: 's', type: 'above', threshold: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const a2 = s.create({ device_id: 'devX', sensor_type: 's', type: 'below', threshold: 2 });
  s.create({ device_id: 'devY', sensor_type: 's', type: 'equals', threshold: 3 });
  const onlyX = s.list({ deviceId: 'devX' });
  assert.equal(onlyX.length, 2);
  assert.equal(onlyX[0].id, a2.id);
  assert.equal(s.list().length, 3);
});

test('remove and removeByDevice', () => {
  const s = makeStore();
  const a1 = s.create({ device_id: 'devZ', sensor_type: 's', type: 'above', threshold: 1 });
  s.create({ device_id: 'devZ', sensor_type: 's', type: 'above', threshold: 2 });
  s.create({ device_id: 'devW', sensor_type: 's', type: 'above', threshold: 3 });
  assert.equal(s.remove('missing'), false);
  assert.equal(s.remove(a1.id), true);
  assert.equal(s.get(a1.id), null);
  s.removeByDevice('devW');
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].device_id, 'devZ');
});