'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-settings-'));
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.RATE_LIMIT_REGISTER = '50';
process.env.STALE_MS = '60000';
process.env.REGISTER_TOKEN = 'env-token';
process.env.PANEL_PASSWORD = '';

const { SettingsStore } = require('../src/settings');

test('fresh store falls back to config/env defaults', () => {
  const s = new SettingsStore();
  assert.equal(s.staleMs(), 60000);
  assert.equal(s.rateLimit('register'), 50);
  assert.equal(s.rateLimit('window_ms'), 60000);
  assert.equal(s.apiToken(), 'env-token');
  assert.equal(s.panelEnabled(), false);
  assert.equal(s.maxDevicesPerIp(), 20);
});

test('update writes every editable key and validates', () => {
  const s = new SettingsStore();
  const r = s.update({
    stale_ms: 90000,
    metrics_hours: 12,
    max_devices_per_ip: 3,
    rate_limits: { register: 7, heartbeat: 200 },
    api_token: 'new-token',
    panel_password: 'super-secret-1',
  });
  assert.equal(r.ok, true);
  assert.ok(r.applied.includes('stale_ms'));
  assert.ok(r.applied.includes('rate_limits'));

  assert.equal(s.staleMs(), 90000);
  assert.equal(s.rateLimit('register'), 7);
  assert.equal(s.rateLimit('heartbeat'), 200);
  assert.equal(s.rateLimit('window_ms'), 60000);
  assert.equal(s.apiToken(), 'new-token');
  assert.equal(s.panelEnabled(), true);
  assert.equal(s.maxDevicesPerIp(), 3);
});

test('invalid values are rejected and ignored', () => {
  const s = new SettingsStore();
  assert.equal(s.update({ stale_ms: -5 }).ok, false);
  assert.equal(s.update({ stale_ms: 'abc' }).ok, false);
  assert.equal(s.update({ panel_password: 'short' }).ok, false);
  assert.equal(s.update({ rate_limits: { register: 'x' } }).ok, false);
  assert.equal(s.update({ max_devices_per_ip: -1 }).ok, false);
  assert.equal(s.update({ stale_ms: 0 }).ok, false);
  assert.equal(s.update({ unknown_key: 1 }).ok, true); // nothing applied
  assert.equal(s.staleMs(), 90000); // unchanged
});

test('runtime overrides survive reload (persisted)', () => {
  const s = new SettingsStore();
  s.update({ stale_ms: 120000 });
  const s2 = new SettingsStore();
  assert.equal(s2.staleMs(), 120000);
  assert.equal(s2.rateLimit('register'), 7);
});

test('clearing api_token via empty string disables auth value', () => {
  const s = new SettingsStore();
  const r = s.update({ api_token: '' });
  assert.equal(r.ok, true);
  assert.equal(s.apiToken(), '');
});