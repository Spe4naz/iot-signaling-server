'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-rules-'));

const { RuleStore } = require('../src/rules');

let seq = 0;
function makeStore() {
  process.env.RULES_FILE = path.join(tmp, `rules-${seq++}.json`);
  return new RuleStore();
}

function baseRule() {
  return {
    name: 'Temp alarm',
    device_id: 'dev1',
    trigger: 'threshold_above',
    sensor_type: 'temperature',
    threshold: 30,
    action: 'notify',
  };
}

test('create returns normalized rule with id', () => {
  const s = makeStore();
  const r = s.create(baseRule());
  assert.ok(r.id);
  assert.ok(r.created_at);
  assert.equal(r.enabled, true);
  assert.equal(r.name, 'Temp alarm');
  assert.equal(r.cooldown_seconds, 60);
});

test('online/offline/no_data triggers need no threshold', () => {
  const s = makeStore();
  for (const trigger of ['online', 'offline', 'no_data']) {
    const r = s.create({ device_id: 'd', trigger, action: 'notify' });
    assert.ok(r, trigger);
    assert.equal(r.sensor_type, '');
    assert.equal(r.threshold, null);
  }
});

test('threshold triggers reject missing sensor_type or threshold', () => {
  const s = makeStore();
  assert.equal(s.create({ device_id: 'd', trigger: 'threshold_above', threshold: 1 }), null);
  assert.equal(s.create({ device_id: 'd', trigger: 'threshold_below', sensor_type: 't' }), null);
  assert.equal(s.create({ device_id: 'd', trigger: 'threshold_above', sensor_type: 't', threshold: 'nan' }), null);
  assert.equal(s.create({ device_id: '', trigger: 'threshold_above', sensor_type: 't', threshold: 1 }), null);
  assert.equal(s.create({ device_id: 'd', trigger: 'invalid_trigger', sensor_type: 't', threshold: 1 }), null);
});

test('create normalizes unknown action to notify', () => {
  const s = makeStore();
  const r = s.create({ ...baseRule(), action: 'launch_missile' });
  assert.equal(r.action, 'notify');
});

test('update merges fields, preserves id and created_at', () => {
  const s = makeStore();
  const r = s.create(baseRule());
  const u = s.update(r.id, { threshold: 42, enabled: false, cooldown_seconds: 5 });
  assert.ok(u);
  assert.equal(u.threshold, 42);
  assert.equal(u.enabled, false);
  assert.equal(u.cooldown_seconds, 5);
  assert.equal(u.id, r.id);
  assert.equal(u.created_at, r.created_at);
  assert.equal(u.device_id, 'dev1');
});

test('update on missing id returns null; invalid update returns null', () => {
  const s = makeStore();
  const r = s.create(baseRule());
  assert.equal(s.update('nope', { threshold: 5 }), null);
  assert.equal(s.update(r.id, { trigger: 'bogus' }), null);
});

test('list filters by device and sorts newest first', async () => {
  const s = makeStore();
  s.create({ ...baseRule(), device_id: 'devX' });
  await new Promise((r) => setTimeout(r, 5));
  const r2 = s.create({ ...baseRule(), device_id: 'devX', action: 'mqtt_command' });
  s.create({ ...baseRule(), device_id: 'devY' });
  const onlyX = s.list({ deviceId: 'devX' });
  assert.equal(onlyX.length, 2);
  assert.equal(onlyX[0].id, r2.id);
  assert.equal(s.list().length, 3);
});

test('remove and removeByDevice', () => {
  const s = makeStore();
  const r1 = s.create({ ...baseRule(), device_id: 'devZ' });
  s.create({ ...baseRule(), device_id: 'devZ' });
  s.create({ ...baseRule(), device_id: 'devW' });
  assert.equal(s.remove('missing'), false);
  assert.equal(s.remove(r1.id), true);
  assert.equal(s.get(r1.id), null);
  s.removeByDevice('devW');
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].device_id, 'devZ');
});