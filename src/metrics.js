'use strict';

const os = require('os');
const fs = require('fs');
const { PersistentFile } = require('./persist');

/**
 * MetricsCollector — rolling samples of host + request performance.
 *
 * Every `intervalMs` a sample {t, cpu%, mem%, load1, net_rx_kb_s, net_tx_kb_s,
 * req_min, avg_ms, online, offline} is recorded. Samples are kept for
 * `hours` and persisted to data/metrics.json so graphs survive restarts.
 *
 * Network I/O uses /proc/net/dev (Linux, incl. containers); on other
 * platforms the net series are null.
 */

function cpuTimes() {
  const total = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
  let cores = 0;
  for (const c of os.cpus()) {
    cores += 1;
    for (const k of Object.keys(total)) total[k] += c.times[k] || 0;
  }
  return { ...total, cores: Math.max(1, cores) };
}

function readNetStats() {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    let rx = 0;
    let tx = 0;
    for (const line of raw.split('\n').slice(2)) {
      const m = line.match(/^\s*[^:]+:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (m) {
        rx += Number(m[1]) || 0;
        tx += Number(m[2]) || 0;
      }
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

function downsample(samples, points) {
  const n = samples.length;
  if (n === 0) return [];
  if (n <= points) {
    return samples.map((s) => ({ ...s }));
  }
  const out = [];
  const bucket = n / points;
  for (let i = 0; i < points; i++) {
    const from = Math.floor(i * bucket);
    const to = Math.max(from + 1, Math.floor((i + 1) * bucket));
    const slice = samples.slice(from, to);
    const acc = {};
    for (const s of slice) {
      for (const k of Object.keys(s)) {
        if (s[k] === null || s[k] === undefined) continue;
        acc[k] = (acc[k] || 0) + s[k];
      }
    }
    const avg = {};
    for (const k of Object.keys(acc)) avg[k] = acc[k] / slice.length;
    avg.t = slice[0].t;
    out.push(avg);
  }
  return out;
}

class MetricsCollector {
  constructor({ file, intervalMs = 10_000, hours = 24 }) {
    this.intervalMs = intervalMs;
    this.hours = hours;
    this._file = new PersistentFile(file, null);
    this.samples = [];
    this._lastCpu = cpuTimes();
    this._lastNet = readNetStats();
    this._lastReq = { count: 0, sumMs: 0, at: Date.now() };
    this._lastNetAt = Date.now();
    this.timer = null;

    const saved = this._file.load();
    if (saved && Array.isArray(saved.samples)) {
      this.samples = saved.samples;
      this._trim();
    }
  }

  start(stats) {
    if (this.timer) return;
    this._stats = stats;
    this.timer = setInterval(() => this.sample(stats), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _windowMs() {
    return this.hours * 3600 * 1000;
  }

  _trim() {
    const cutoff = Date.now() - this._windowMs();
    if (this.samples.length && this.samples[0].t < cutoff) {
      const idx = this.samples.findIndex((s) => s.t >= cutoff);
      this.samples = idx === -1 ? [] : this.samples.slice(idx);
    }
  }

  sample(stats) {
    const now = Date.now();

    // CPU % from delta of core time counters.
    const cur = cpuTimes();
    const dIdle = cur.idle - this._lastCpu.idle;
    const dTotal =
      cur.user +
      cur.nice +
      cur.sys +
      cur.irq +
      cur.idle -
      (this._lastCpu.user + this._lastCpu.nice + this._lastCpu.sys + this._lastCpu.irq + this._lastCpu.idle);
    this._lastCpu = cur;
    const cpu = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;

    const memTotal = os.totalmem();
    const mem = memTotal > 0 ? ((memTotal - os.freemem()) / memTotal) * 100 : 0;

    let net_rx_kb_s = null;
    let net_tx_kb_s = null;
    const net = readNetStats();
    if (net && this._lastNet) {
      const dt = (now - this._lastNetAt) / 1000;
      if (dt > 0) {
        net_rx_kb_s = Math.max(0, (net.rx - this._lastNet.rx) / dt / 1024);
        net_tx_kb_s = Math.max(0, (net.tx - this._lastNet.tx) / dt / 1024);
      }
    }
    this._lastNet = net;
    this._lastNetAt = now;

    let req_min = 0;
    let avg_ms = 0;
    if (stats && stats.requests) {
      const dt = (now - this._lastReq.at) / 1000;
      if (dt > 0) req_min = (stats.requests.count / dt) * 60;
      avg_ms = stats.requests.count > 0 ? stats.requests.sumMs / stats.requests.count : 0;
      this._lastReq = { count: stats.requests.count, sumMs: stats.requests.sumMs, at: now };
      stats.requests.count = 0;
      stats.requests.sumMs = 0;
    }

    const devStats = stats && stats.devices ? stats.devices() : { total: 0, online: 0, offline: 0 };
    const load = os.loadavg();

    this.samples.push({
      t: now,
      cpu: Math.round(cpu * 10) / 10,
      mem: Math.round(mem * 10) / 10,
      load1: load[0] !== undefined ? Math.round(load[0] * 100) / 100 : null,
      net_rx_kb_s: net_rx_kb_s !== null ? Math.round(net_rx_kb_s) : null,
      net_tx_kb_s: net_tx_kb_s !== null ? Math.round(net_tx_kb_s) : null,
      req_min: Math.round(req_min),
      avg_ms: Math.round(avg_ms * 10) / 10,
      online: devStats.online,
      offline: devStats.offline,
    });

    this._trim();
  }

  /** Downsampled series for charts. */
  history(points = 120) {
    const samples = this.samples.slice();
    const perf = downsample(samples, Math.max(2, Math.min(600, Number(points) || 120)));
    const out = { perf: [], online: [] };
    for (const s of perf) {
      out.perf.push({
        t: s.t,
        cpu: s.cpu,
        mem: s.mem,
        load1: s.load1,
        net_rx_kb_s: s.net_rx_kb_s,
        net_tx_kb_s: s.net_tx_kb_s,
        req_min: s.req_min,
        avg_ms: s.avg_ms,
      });
      out.online.push({ t: s.t, online: s.online, offline: s.offline });
    }
    return out;
  }

  last() {
    const s = this.samples[this.samples.length - 1];
    return s || null;
  }

  flush() {
    this._trim();
    const persisted = {
      startedAt: this.samples.length ? this.samples[0].t : Date.now(),
      samples: this.samples,
    };
    this._file.save(persisted);
  }
}

module.exports = { MetricsCollector, downsample };