'use strict';

const { PersistentFile } = require('./persist');
const config = require('./config');

/**
 * DeviceRegistry — registry of IoT devices with persistent storage.
 * Stores only connection metadata (id, name, ip, port, status).
 * Does NOT store sensor data — devices serve it directly.
 *
 * Devices that stop heartbeating are kept but marked `status:'offline'`.
 */

const STALE_MS = config.registry.staleMs; // without heartbeat -> offline
const CLEANUP_INTERVAL_MS = config.registry.cleanupIntervalMs;
const SAVE_DEBOUNCE_MS = 3_000;
const DEFAULT_FILE = config.registry.file;

const IP_RE = /^\[?([0-9a-fA-F.:]+)\]?$/;
const MAX_ID_LEN = 64;
const MAX_NAME_LEN = 128;
const MAX_TYPE_LEN = 64;
const MAX_IP_LEN = 45;
const MAX_SENSORS = 64;

function isValidIp(ip) {
  if (typeof ip !== 'string' || ip.length > MAX_IP_LEN || ip.length === 0) return false;
  const bare = ip.replace(/^\[|\]$/g, '').trim();
  if (!IP_RE.test(bare)) return false;

  if (bare.includes(':')) {
    // IPv6 (with optional IPv4-mapped suffix) — accept if it parses as netwerk address
    if (!bare.includes('.')) return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(bare);
    // v4-mapped like ::ffff:127.0.0.1 — validate the trailing part below
    const parts = bare.split(':');
    return parts.some((p) => /^\d{1,3}(\.\d{1,3}){3}$/.test(p));
  }

  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

class DeviceRegistry {
  constructor() {
    this.devices = new Map();
    this._file = new PersistentFile(
      config.registry.file,
      [],
    );
    this._saveTimer = null;

    const saved = this._file.load();
    if (Array.isArray(saved)) {
      for (const d of saved) {
        if (d && typeof d.id === 'string') this.devices.set(d.id, d);
      }
    }

    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();

    console.log(`[registry] loaded ${this.devices.size} device(s) from ${this._file.filePath}`);
    console.log(`[registry] stale_offline_ms=${STALE_MS} cleanup_ms=${CLEANUP_INTERVAL_MS}`);
  }

  register(data) {
    if (!data || !data.id) return null;
    if (!isValidIp(data.ip)) return null;

    const now = Date.now();
    const existing = this.devices.get(String(data.id));

    const device = {
      id: String(data.id).slice(0, MAX_ID_LEN),
      name: String(data.name || data.id).slice(0, MAX_NAME_LEN),
      type: String(data.type || 'esp32').slice(0, MAX_TYPE_LEN),
      ip: data.ip.slice(0, MAX_IP_LEN),
      port: Number(data.port) > 0 && Number(data.port) <= 65535 ? Number(data.port) : 0,
      status: 'online',
      sensors: Array.isArray(data.sensors)
        ? [...new Set(data.sensors.map((s) => String(s).slice(0, 64)))].slice(0, MAX_SENSORS)
        : [],
      mqttBroker: data.mqttBroker ? String(data.mqttBroker).slice(0, 128) : null,
      firmwareVersion:
        data.firmwareVersion && typeof data.firmwareVersion === 'string'
          ? data.firmwareVersion.slice(0, 32)
          : (existing && existing.firmwareVersion) || null,
      offlineAt: existing && existing.status === 'online' ? existing.offlineAt : null,
      firstSeen: existing ? existing.firstSeen : now,
      lastSeen: now,
    };

    this.devices.set(device.id, device);
    this._markDirty();
    return device;
  }

  heartbeat(id, data) {
    const device = this.devices.get(String(id));
    if (!device) return null;
    device.lastSeen = Date.now();
    device.status = 'online';
    device.offlineAt = null;
    if (
      data &&
      typeof data.firmwareVersion === 'string' &&
      data.firmwareVersion.trim().length > 0
    ) {
      device.firmwareVersion = data.firmwareVersion.trim().slice(0, 32);
    }
    this._markDirty();
    return device;
  }

  list(filter = {}) {
    let result = [...this.devices.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (filter.online === true) result = result.filter((d) => d.status === 'online');
    if (filter.online === false) result = result.filter((d) => d.status !== 'online');
    return result;
  }

  get(id) {
    return this.devices.get(String(id)) || null;
  }

  remove(id) {
    const removed = this.devices.delete(String(id));
    if (removed) this._markDirty();
    return removed;
  }

  stats() {
    let online = 0;
    let offline = 0;
    for (const d of this.devices.values()) {
      if (d.status === 'online') online += 1;
      else offline += 1;
    }
    return { total: this.devices.size, online, offline };
  }

  countByIp(ip) {
    let n = 0;
    for (const d of this.devices.values()) {
      if (d.ip === ip) n += 1;
    }
    return n;
  }

  /** Mark stale devices offline (kept in the registry, NOT deleted). */
  cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [id, device] of this.devices) {
      if (device.status !== 'online') continue;
      if (now - device.lastSeen > STALE_MS) {
        device.status = 'offline';
        device.offlineAt = now;
        console.log(`[registry] device offline (stale): ${id} (${device.name})`);
        changed = true;
      }
    }
    if (changed) this._markDirty();
  }

  _markDirty() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    this._saveTimer.unref();
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._file.save([...this.devices.values()]);
  }
}

module.exports = { DeviceRegistry, STALE_MS };