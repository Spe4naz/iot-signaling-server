'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-regupdate-'));
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');

const { DeviceRegistry } = require('../src/registry');

function makeRegistry() {
  const r = new DeviceRegistry();
  r.register({ id: 'd1', ip: '10.0.0.1', name: 'Kitchen', type: 'esp32', port: 81, sensors: ['t', 'h'] });
  return r;
}

test('update edits metadata in place', () => {
  const r = makeRegistry();
  const d = r.update('d1', { name: 'Living', type: 'esp32s3', port: 8080 });
  assert.ok(d);
  assert.equal(d.name, 'Living');
  assert.equal(d.type, 'esp32s3');
  assert.equal(d.port, 8080);
  assert.equal(r.get('d1').ip, '10.0.0.1');
});

test('update replaces sensors with dedupe + cap', () => {
  const r = makeRegistry();
  const many = Array.from({ length: 70 }, (_, i) => `s${i}`);
  const d = r.update('d1', { sensors: [...many, ...many] });
  assert.equal(d.sensors.length, 64);
});

test('update rejects invalid ip / port / sensors', () => {
  const r = makeRegistry();
  const badIp = r.update('d1', { ip: 'nope' });
  assert.ok(badIp instanceof Error);
  assert.equal(badIp.code, 'EINVAL');
  assert.equal(r.get('d1').ip, '10.0.0.1');

  const badPort = r.update('d1', { port: 0 });
  assert.ok(badPort instanceof Error);
  assert.equal(badPort.code, 'EINVAL');

  const badSensors = r.update('d1', { sensors: 't' });
  assert.ok(badSensors instanceof Error);
  assert.equal(r.get('d1').sensors.length, 2);
});

test('update unknown device returns null', () => {
  const r = makeRegistry();
  assert.equal(r.update('missing', { name: 'x' }), null);
});

test('update is persistent (markDirty → flush)', async () => {
  const r = makeRegistry();
  r.update('d1', { name: 'Persisted' });
  await new Promise((res) => setTimeout(res, 40));
  r.flush();

  const r2 = new DeviceRegistry();
  assert.equal(r2.get('d1').name, 'Persisted');
});