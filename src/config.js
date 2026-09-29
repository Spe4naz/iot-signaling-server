'use strict';

/**
 * Centralized server configuration.
 * Every tunable (port, host, API prefix, rate limits, auth, persistence
 * paths, staleness) is defined here — modules import from this single file
 * instead of scattering process.env reads across the codebase.
 */

const path = require('path');

const VERSION = require('../package.json').version;

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envStr(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

const config = {
  version: VERSION,

  // Set BEFORE require(): test files override REGISTRY_FILE/ALERTS_FILE.
  init: null,

  apiPrefix: envStr('API_PREFIX', '/api/v1'),

  server: {
    port: envInt('PORT', 3000),
    // Bind to loopback by default — public access goes through nginx
    // (TLS/rate rules). Override with HOST=0.0.0.0 to publish directly.
    host: envStr('HOST', '127.0.0.1'),
  },

  auth: {
    // Optional write token — when set, register/delete/alerts writes and
    // device reads require: Authorization: Bearer <token>
    registerToken: envStr('REGISTER_TOKEN', ''),
    get enabled() {
      return this.registerToken.length > 0;
    },
  },

  panel: {
    // Web admin panel (3X-UI-like). Enabled when a password is configured.
    path: envStr('PANEL_PATH', '/panel'),
    password: envStr('PANEL_PASSWORD', ''),
    sessionTtlMs: envInt('PANEL_SESSION_TTL_MS', 24 * 3600 * 1000),
    // Static bundle (Vue built output) shipped in web/dist
    get staticDir() {
      return envStr('PANEL_STATIC_DIR', path.join(__dirname, '..', 'web', 'dist'));
    },
  },

  metrics: {
    intervalMs: envInt('METRICS_INTERVAL_MS', 10_000),
    hours: envInt('METRICS_HOURS', 24),
    flushSeconds: envInt('METRICS_FLUSH_SECONDS', 120),
    get file() {
      return envStr('METRICS_FILE', path.join(__dirname, '..', 'data', 'metrics.json'));
    },
  },

  stability: {
    maxEvents: envInt('STABILITY_MAX_EVENTS', 5000),
    get file() {
      return envStr('STABILITY_FILE', path.join(__dirname, '..', 'data', 'stability.json'));
    },
  },

  settings: {
    get file() {
      return envStr('SETTINGS_FILE', path.join(__dirname, '..', 'data', 'settings.json'));
    },
  },

  rateLimit: {
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
    register: envInt('RATE_LIMIT_REGISTER', 20),    // /min
    heartbeat: envInt('RATE_LIMIT_HEARTBEAT', 120),  // /min
    write: envInt('RATE_LIMIT_WRITE', 60),           // /min
    read: envInt('RATE_LIMIT_READ', 120),            // /min
  },

  registry: {
    staleMs: envInt('STALE_MS', 180_000), // 3 min without heartbeat -> offline
    cleanupIntervalMs: envInt('CLEANUP_INTERVAL_MS', 30_000),
    maxDevicesPerIp: envInt('MAX_DEVICES_PER_IP', 20),
    // Lazy getter so tests/embedders may override the env var at runtime.
    get file() {
      return envStr('REGISTRY_FILE', path.join(__dirname, '..', 'data', 'devices.json'));
    },
  },

  alerts: {
    get file() {
      return envStr('ALERTS_FILE', path.join(__dirname, '..', 'data', 'alerts.json'));
    },
  },

  rules: {
    get file() {
      return envStr('RULES_FILE', path.join(__dirname, '..', 'data', 'rules.json'));
    },
  },
};

module.exports = config;