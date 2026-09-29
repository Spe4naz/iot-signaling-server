'use strict';

const crypto = require('crypto');
const { PersistentFile } = require('./persist');
const config = require('./config');

/**
 * AlertStore — CRUD + persistent storage for device alerts.
 * Contract matches the Flutter app model (models/alert.dart):
 *   id, device_id, sensor_type, type (above|below|equals),
 *   threshold, is_active, created_at, triggered_at.
 */

const ALERT_TYPES = ['above', 'below', 'equals'];
const DEFAULT_FILE = config.alerts.file;

function normalizeAlert(data, nowISO) {
  if (!data || typeof data !== 'object') return null;

  const type = String(data.type || '');
  if (!ALERT_TYPES.includes(type)) return null;

  const deviceId = String(data.device_id || '').slice(0, 64);
  const sensorType = String(data.sensor_type || '').slice(0, 64);
  if (!deviceId || !sensorType) return null;

  const threshold = Number(data.threshold);
  if (!Number.isFinite(threshold)) return null;

  return {
    device_id: deviceId,
    sensor_type: sensorType,
    type,
    threshold,
    is_active: data.is_active === undefined ? true : Boolean(data.is_active),
    created_at: nowISO,
    triggered_at: data.triggered_at ? String(data.triggered_at) : null,
  };
}

class AlertStore {
  constructor() {
    this._file = new PersistentFile(
      config.alerts.file,
      [],
    );
    const saved = this._file.load();
    this.alerts = Array.isArray(saved) ? saved : [];
    console.log(`[alerts] loaded ${this.alerts.length} alert(s) from ${this._file.filePath}`);
  }

  list(filter = {}) {
    let result = this.alerts.slice();
    if (filter.deviceId) {
      result = result.filter((a) => a.device_id === filter.deviceId);
    }
    return result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  get(id) {
    return this.alerts.find((a) => a.id === id) || null;
  }

  create(data) {
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const alert = normalizeAlert(data, nowISO);
    if (!alert) return null;

    alert.id = crypto.randomUUID();
    this.alerts.push(alert);
    this._persist();
    return alert;
  }

  update(id, data) {
    const index = this.alerts.findIndex((a) => a.id === id);
    if (index === -1) return null;

    const current = this.alerts[index];
    const nowISO = new Date().toISOString();
    const merged = normalizeAlert({ ...current, ...data }, nowISO);
    if (!merged) return null;

    merged.id = current.id;
    merged.created_at = current.created_at;
    this.alerts[index] = merged;
    this._persist();
    return merged;
  }

  remove(id) {
    const index = this.alerts.findIndex((a) => a.id === id);
    if (index === -1) return false;
    this.alerts.splice(index, 1);
    this._persist();
    return true;
  }

  removeByDevice(deviceId) {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => a.device_id !== deviceId);
    if (this.alerts.length !== before) this._persist();
  }

  _persist() {
    this._file.save(this.alerts);
  }
}

module.exports = { AlertStore, ALERT_TYPES };