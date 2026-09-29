'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-metrics-'));
process.env.METRICS_FILE = path.join(tmp, 'metrics.json');

const { MetricsCollector, downsample } = require('../src/metrics');

const stats = {
  requests: { count: 5, sumMs: 120 },
  devices: () => ({ total: 2, online: 1, offline: 1 }),
};

function makeCollector({ hours = 1 } = {}) {
  return new MetricsCollector({ file: process.env.METRICS_FILE, intervalMs: 3600_000, hours });
}

test('sample produces full shape with finite numbers', () => {
  const c = makeCollector();
  c.sample(stats);
  assert.equal(c.samples.length, 1);
  const s = c.samples[0];
  for (const k of ['t', 'cpu', 'mem', 'load1', 'req_min', 'avg_ms', 'online', 'offline']) {
    assert.equal(typeof s[k], 'number', `${k} is number`);
  }
  assert.ok(Number.isFinite(s.cpu) && s.cpu >= 0 && s.cpu <= 100);
  assert.ok(Number.isFinite(s.mem) && s.mem >= 0 && s.mem <= 100);
  assert.equal(s.online, 1);
  assert.equal(s.offline, 1);
});

test('sample resets request counters', () => {
  const c = makeCollector();
  stats.requests.count = 10;
  stats.requests.sumMs = 300;
  c.sample(stats);
  assert.equal(stats.requests.count, 0);
  assert.equal(stats.requests.sumMs, 0);
});

test('window trimming keeps only recent samples', () => {
  const c = makeCollector({ hours: 1 });
  const now = Date.now();
  // Manually seed with old samples to force trimming.
  c.samples = [
    { t: now - 7200_000, cpu: 10, mem: 10, load1: 1, req_min: 0, avg_ms: 0, online: 0, offline: 1 },
    { t: now - 1000, cpu: 20, mem: 20, load1: 2, req_min: 3, avg_ms: 4, online: 2, offline: 0 },
    { t: now, cpu: 30, mem: 30, load1: 3, req_min: 5, avg_ms: 6, online: 2, offline: 0 },
  ];
  c._trim();
  assert.equal(c.samples.length, 2);
  assert.ok(c.samples[0].t >= now - 3600_000);
});

test('history downsamples to requested points', () => {
  const c = makeCollector();
  const now = Date.now();
  const arr = [];
  for (let i = 0; i < 500; i++) {
    arr.push({ t: now - i * 1000, cpu: i % 100, mem: 40, load1: 1, req_min: 2, avg_ms: 3, online: 1, offline: 0 });
  }
  c.samples = arr;
  const h = c.history(120);
  assert.ok(h.perf.length <= 120 && h.perf.length >= 2);
  assert.equal(h.perf.length, h.online.length);
  assert.ok(h.perf[0].cpu !== undefined);
});

test('downsample returns all when n <= points', () => {
  const c = makeCollector();
  const now = Date.now();
  c.samples = [
    { t: now - 2000, cpu: 1, mem: 2, load1: 3, req_min: 4, avg_ms: 5, online: 1, offline: 0 },
  ];
  const out = downsample(c.samples, 120);
  assert.equal(out.length, 1);
});

test('flush persists and reloads samples', () => {
  const c = makeCollector();
  c.sample(stats);
  c.sample(stats);
  c.flush();

  const c2 = new MetricsCollector({ file: process.env.METRICS_FILE, intervalMs: 3600_000, hours: 1 });
  assert.equal(c2.samples.length, 2);
  assert.equal(typeof c2.samples[0].cpu, 'number');
});