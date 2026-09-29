'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-stability-'));
process.env.STABILITY_FILE = path.join(tmp, 'stability.json');

const { StabilityStore } = require('../src/stability');

function makeStore() {
  return new StabilityStore({ file: process.env.STABILITY_FILE });
}

const H = 3600_000;

test('record dedupes consecutive equal statuses', () => {
  const s = makeStore();
  s.record('a', 'online');
  s.record('a', 'online');
  s.record('a', 'offline');
  s.record('a', 'offline');
  assert.equal(s.events('a').length, 2);
  assert.deepEqual(
    s.events('a').map((e) => e.s),
    ['online', 'offline'],
  );
});

test('ensureOnline seeds a device with a baseline', () => {
  const s = makeStore();
  s.ensureOnline('d');
  s.ensureOnline('d');
  assert.equal(s.events('d').length, 1);
  assert.equal(s.events('d')[0].s, 'online');
});

test('uptime math — offline window', () => {
  const s = makeStore();
  const now = Date.now();
  s._data = {
    a: [
      { t: now - 50_000, s: 'online' },
      { t: now - 25_000, s: 'offline' },
    ],
  };
  // 25s online of the last 25s lifespan -> 50% (judged by lifetime since first event)
  assert.equal(s.uptimePct('a', 7 * 24 * H, 'offline'), 50);
});

test('uptime math — long history, recent offline dip', () => {
  const s = makeStore();
  const now = Date.now();
  const day = 24 * H;
  s._data = {
    a: [
      { t: now - 3 * day, s: 'online' },
      { t: now - 2 * day, s: 'offline' },
      { t: now - 1 * day, s: 'online' },
      { t: now - 300_000, s: 'offline' },
    ],
  };
  // In the last 24h the device was online 24h minus the final 5min dip -> ~99.65%
  const pct = s.uptimePct('a', day, 'offline');
  assert.ok(pct > 99 && pct < 100);
});

test('uptime math — currently online open interval counts', () => {
  const s = makeStore();
  const now = Date.now();
  const day = 24 * H;
  s._data = {
    a: [
      { t: now - 12 * 3600_000, s: 'online' },
      { t: now - 8 * 3600_000, s: 'offline' },
      { t: now - 4 * 3600_000, s: 'online' },
    ],
  };
  // Lifespan = 12h (first event). Online: 12-8h (4h) + 4h-now (4h) = 8h -> 66.67%
  const pct = s.uptimePct('a', day, 'online');
  assert.ok(Math.abs(pct - 66.667) < 0.2);
});

test('uptime with no events is 0', () => {
  const s = makeStore();
  assert.equal(s.uptimePct('nope', 24 * H, 'online'), 0);
});

test('removeDevice clears journal', () => {
  const s = makeStore();
  s.record('x', 'online');
  s.removeDevice('x');
  assert.equal(s.events('x').length, 0);
});

test('flush persists and reloads', () => {
  const s = makeStore();
  s.record('p', 'online');
  s.flush();
  const s2 = new StabilityStore({ file: process.env.STABILITY_FILE });
  assert.equal(s2.events('p').length, 1);
});