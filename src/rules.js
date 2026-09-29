'use strict';

const crypto = require('crypto');
const { PersistentFile } = require('./persist');
const config = require('./config');

/**
 * RuleStore — CRUD + persistent storage for smart-home rules.
 * Rules describe what the app should do when a device crosses a threshold
 * (or goes online/offline). Evaluation happens client-side (the server
 * receives no telemetry); the server only persists the rule definitions.
 *
 * Contract matches the Flutter app model (models/smart_rule.dart):
 *   id, name, enabled, device_id, trigger (threshold_above|threshold_below|
 *   online|offline|no_data), sensor_type, threshold, action
 *   (notify|mqtt_command|device_command), action_payload, cooldown_seconds,
 *   created_at.
 */

const TRIGGERS = ['threshold_above', 'threshold_below', 'online', 'offline', 'no_data'];
const ACTIONS = ['notify', 'mqtt_command', 'device_command'];

function normalizeRule(data, nowISO) {
  if (!data || typeof data !== 'object') return null;

  const trigger = String(data.trigger || '').trim();
  if (!TRIGGERS.includes(trigger)) return null;

  const deviceId = String(data.device_id || '').slice(0, 64);
  if (!deviceId) return null;

  let action = String(data.action || 'notify').trim();
  if (!ACTIONS.includes(action)) action = 'notify';

  let threshold = null;
  const sensorType = String(data.sensor_type || '').trim().slice(0, 64);
  if (trigger === 'threshold_above' || trigger === 'threshold_below') {
    if (!sensorType) return null;
    threshold = Number(data.threshold);
    if (!Number.isFinite(threshold)) return null;
  }

  const cooldown = Number(data.cooldown_seconds);
  const cooldownSeconds = Number.isFinite(cooldown) && cooldown >= 0
    ? Math.min(Math.floor(cooldown), 86400 * 7)
    : 60;

  return {
    name: String(data.name || deviceId).trim().slice(0, 128) || deviceId,
    enabled: data.enabled === undefined ? true : Boolean(data.enabled),
    device_id: deviceId,
    trigger,
    sensor_type: sensorType,
    threshold,
    action,
    action_payload: String(data.action_payload ?? '').slice(0, 512),
    cooldown_seconds: cooldownSeconds,
    created_at: nowISO,
  };
}

class RuleStore {
  constructor() {
    this._file = new PersistentFile(config.rules.file, []);
    const saved = this._file.load();
    this.rules = Array.isArray(saved) ? saved : [];
    console.log(`[rules] loaded ${this.rules.length} rule(s) from ${this._file.filePath}`);
  }

  list(filter = {}) {
    let result = this.rules.slice();
    if (filter.deviceId) {
      result = result.filter((r) => r.device_id === filter.deviceId);
    }
    return result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  get(id) {
    return this.rules.find((r) => r.id === id) || null;
  }

  create(data) {
    const nowISO = new Date().toISOString();
    const rule = normalizeRule(data, nowISO);
    if (!rule) return null;

    rule.id = crypto.randomUUID();
    this.rules.push(rule);
    this._persist();
    return rule;
  }

  update(id, data) {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const current = this.rules[index];
    const nowISO = new Date().toISOString();
    const merged = normalizeRule({ ...current, ...data }, nowISO);
    if (!merged) return null;

    merged.id = current.id;
    merged.created_at = current.created_at;
    this.rules[index] = merged;
    this._persist();
    return merged;
  }

  remove(id) {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    this._persist();
    return true;
  }

  removeByDevice(deviceId) {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.device_id !== deviceId);
    if (this.rules.length !== before) this._persist();
  }

  _persist() {
    this._file.save(this.rules);
  }
}

module.exports = { RuleStore, TRIGGERS, ACTIONS };