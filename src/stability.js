'use strict';

const { PersistentFile } = require('./persist');

/**
 * StabilityStore — per-device status-change journal + uptime math.
 *
 * Records transitions only ({t, s: 'online'|'offline'}), so it stays small.
 * Persisted to data/stability.json. Uptime % is computed from the journal
 * for the requested window (e.g. 24h / 7d).
 */

const MAX_EVENTS_DEFAULT = 5000;
const UP_WINDOW_24H = 24 * 3600 * 1000;
const UP_WINDOW_7D = 7 * 24 * 3600 * 1000;

class StabilityStore {
  constructor({ file, maxEvents = MAX_EVENTS_DEFAULT } = {}) {
    this.maxEvents = maxEvents;
    this._file = new PersistentFile(file, null);
    this._data = null;
    this._saveTimer = null;

    const saved = this._file.load();
    if (saved && saved.devices && typeof saved.devices === 'object') {
      this._data = saved.devices;
      for (const id of Object.keys(this._data)) {
        if (!Array.isArray(this._data[id])) this._data[id] = [];
      }
    } else {
      this._data = {};
    }
  }

  /** Push a status event if it differs from the last recorded one. */
  record(id, status) {
    const key = String(id);
    const events = this._data[key] || (this._data[key] = []);
    const last = events[events.length - 1];
    if (last && last.s === status) return;
    events.push({ t: Date.now(), s: status === 'offline' ? 'offline' : 'online' });

    const cap = Math.max(500, this.maxEvents);
    const excess = events.length - cap / 2;
    if (excess > 0) events.splice(0, excess);

    this._markDirty();
  }

  ensureOnline(id) {
    const key = String(id);
    const events = this._data[key];
    if (!events || !events.length || events[events.length - 1].s !== 'online') {
      this.record(key, 'online');
    }
  }

  removeDevice(id) {
    const key = String(id);
    if (this._data[key]) {
      delete this._data[key];
      this._markDirty();
    }
  }

  events(id) {
    const key = String(id);
    return (this._data[key] || []).slice();
  }

  /**
   * Uptime % in `windowMs` ending now, given the device's current status.
   * Clamps to the first recorded event (a device present for < window is
   * judged by its actual lifetime, so a 2h-old device can show 100%).
   */
  uptimePct(id, windowMs, currentStatus) {
    const events = this.events(id);
    if (!events.length) return 0;

    const now = Date.now();
    const start = now - windowMs;
    let onlineMs = 0;

    // Assume offline before the first event.
    let cur = 'offline';
    let prevT = events[0].t <= start ? start : events[0].t;
    cur = events[0].s;

    for (let i = 1; i < events.length; i++) {
      const e = events[i];
      const segStart = Math.max(prevT, start);
      const segEnd = Math.min(e.t, now);
      if (cur === 'online' && segEnd > segStart) onlineMs += segEnd - segStart;
      prevT = e.t;
      cur = e.s;
    }

    if (cur === 'online' && currentStatus === 'online') {
      const lastEventT = events[events.length - 1].t;
      const segStart = Math.max(lastEventT, start);
      onlineMs += Math.max(0, now - segStart);
    }

    const lifespan = Math.min(windowMs, Math.max(0, now - events[0].t));
    if (lifespan <= 0) return 0;
    const pct = (onlineMs / lifespan) * 100;
    return Math.min(100, Math.round(pct * 10) / 10);
  }

  uptime24h(id, status) {
    return this.uptimePct(id, UP_WINDOW_24H, status);
  }

  uptime7d(id, status) {
    return this.uptimePct(id, UP_WINDOW_7D, status);
  }

  _markDirty() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 2_000);
    this._saveTimer.unref();
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._file.save({ devices: this._data, updatedAt: Date.now() });
  }
}

module.exports = { StabilityStore, MAX_EVENTS_DEFAULT, UP_WINDOW_24H, UP_WINDOW_7D };