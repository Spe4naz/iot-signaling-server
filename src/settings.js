'use strict';

const { PersistentFile } = require('./persist');
const config = require('./config');

/**
 * SettingsStore — runtime override layer on top of the env-based config.
 *
 * Values saved here (via the web panel / PUT /panel/api/settings) win over
 * env vars for the settings the panel exposes. Everything else still comes
 * from config (env with factory defaults).
 *
 * Persisted to data/settings.json. Never contains secrets for list views —
 * the panel must not echo api_token / panel_password back.
 */

const NUM_KEYS = {
  stale_ms: { min: 1000, max: 86400 * 7 * 1000 },
  metrics_hours: { min: 1, max: 24 * 30 },
  session_ttl_ms: { min: 60 * 1000, max: 30 * 24 * 3600 * 1000 },
};
const RATE_KEYS = {
  window_ms: { min: 1000, max: 3600 * 1000 },
  register: { min: 1, max: 10000 },
  heartbeat: { min: 1, max: 100000 },
  write: { min: 1, max: 100000 },
  read: { min: 1, max: 100000 },
};
const STR_KEYS = {
  api_token: { max: 256, allowEmpty: true },
  panel_password: { min: 8, max: 128 },
};

// settings key -> config.rateLimit key (config uses camelCase for windowMs)
const FALLBACK_KEYS = {
  window_ms: 'windowMs',
  register: 'register',
  heartbeat: 'heartbeat',
  write: 'write',
  read: 'read',
};

function clampInt(value, spec) {
  const n = Number(value);
  if (!Number.isInteger(n) || Number.isNaN(n) || !Number.isFinite(n)) return null;
  if (n < spec.min || n > spec.max) return null;
  return n;
}

class SettingsStore {
  constructor() {
    this._file = new PersistentFile(config.settings.file, {});
    this.overrides = this._file.load();
    if (typeof this.overrides !== 'object' || this.overrides === null) this.overrides = {};
  }

  get(key) {
    return this.overrides[key];
  }

  /** Prefer a runtime override, fall back to the env-derived config value. */
  fallbackNum(key, fallback) {
    const v = this.get(key);
    const spec = NUM_KEYS[key];
    if (v !== undefined && spec) {
      const clamped = clampInt(v, spec);
      if (clamped !== null) return clamped;
    }
    return fallback;
  }

  staleMs() {
    return this.fallbackNum('stale_ms', config.registry.staleMs);
  }

  sessionTtlMs() {
    return this.fallbackNum('session_ttl_ms', config.panel.sessionTtlMs);
  }

  metricsHours() {
    return this.fallbackNum('metrics_hours', config.metrics.hours);
  }

  maxDevicesPerIp() {
    return this.rawNum('max_devices_per_ip', config.registry.maxDevicesPerIp);
  }

  rawNum(key, fallback) {
    const v = this.get(key);
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return fallback;
  }

  rateLimit(name) {
    const spec = RATE_KEYS[name];
    if (!spec) return undefined;
    const overrides = this.get('rate_limits');
    const v = overrides && typeof overrides[name] !== 'undefined' ? overrides[name] : undefined;
    if (v !== undefined) {
      const clamped = clampInt(v, spec);
      if (clamped !== null) return clamped;
    }
    return config.rateLimit[FALLBACK_KEYS[name]];
  }

  apiToken() {
    const v = this.get('api_token');
    if (typeof v === 'string') return v;
    return config.auth.registerToken;
  }

  panelPassword() {
    const v = this.get('panel_password');
    if (typeof v === 'string' && v.length > 0) return v;
    return config.panel.password;
  }

  panelEnabled() {
    return this.panelPassword().length > 0;
  }

  update(patch) {
    if (!patch || typeof patch !== 'object') return { ok: false, error: 'invalid_payload' };

    const next = {};
    const errors = [];
    let changed = false;

    if (patch.stale_ms !== undefined || this.get('stale_ms') !== undefined) {
      const v = patch.stale_ms === undefined ? this.get('stale_ms') : patch.stale_ms;
      const clamped = clampInt(v, NUM_KEYS.stale_ms);
      if (clamped === null) return { ok: false, error: 'invalid_stale_ms' };
      next.stale_ms = clamped;
      changed = true;
    }

    if (patch.metrics_hours !== undefined || this.get('metrics_hours') !== undefined) {
      const v = patch.metrics_hours === undefined ? this.get('metrics_hours') : patch.metrics_hours;
      const clamped = clampInt(v, NUM_KEYS.metrics_hours);
      if (clamped === null) return { ok: false, error: 'invalid_metrics_hours' };
      next.metrics_hours = clamped;
      changed = true;
    }

    if (patch.max_devices_per_ip !== undefined || this.get('max_devices_per_ip') !== undefined) {
      const v =
        patch.max_devices_per_ip === undefined ? this.get('max_devices_per_ip') : patch.max_devices_per_ip;
      const n = Number(v);
      if (!Number.isInteger(n) || Number.isNaN(n) || n < 0 || n > 100000) {
        return { ok: false, error: 'invalid_max_devices_per_ip' };
      }
      next.max_devices_per_ip = n;
      changed = true;
    }

    if (
      patch.session_ttl_ms !== undefined ||
      (patch.session_ttl !== undefined) ||
      this.get('session_ttl_ms') !== undefined
    ) {
      const v =
        patch.session_ttl_ms !== undefined
          ? patch.session_ttl_ms
          : patch.session_ttl !== undefined
            ? patch.session_ttl
            : this.get('session_ttl_ms');
      const clamped = clampInt(v, NUM_KEYS.session_ttl_ms);
      if (clamped === null) return { ok: false, error: 'invalid_session_ttl_ms' };
      next.session_ttl_ms = clamped;
      changed = true;
    }

    if (patch.rate_limits !== undefined || this.get('rate_limits') !== undefined) {
      const base = patch.rate_limits === undefined ? this.get('rate_limits') : patch.rate_limits;
      if (!base || typeof base !== 'object') return { ok: false, error: 'invalid_rate_limits' };
      const limits = {};
      for (const name of Object.keys(RATE_KEYS)) {
        const v = base[name];
        if (v === undefined) {
          const existing = this.get('rate_limits');
          if (existing && typeof existing[name] !== 'undefined') limits[name] = existing[name];
          continue;
        }
        const clamped = clampInt(v, RATE_KEYS[name]);
        if (clamped === null) return { ok: false, error: `invalid_rate_limit_${name}` };
        limits[name] = clamped;
      }
      next.rate_limits = limits;
      changed = true;
    }

    if (patch.api_token !== undefined) {
      const v = String(patch.api_token);
      if (v.length > STR_KEYS.api_token.max) return { ok: false, error: 'invalid_api_token' };
      next.api_token = v;
      changed = true;
    }

    if (patch.panel_password !== undefined) {
      const v = String(patch.panel_password);
      if (v.length === 0) return { ok: false, error: 'invalid_panel_password' };
      if (v.length < STR_KEYS.panel_password.min || v.length > STR_KEYS.panel_password.max) {
        return { ok: false, error: 'invalid_panel_password' };
      }
      next.panel_password = v;
      changed = true;
    }

    if (!changed) return { ok: true, applied: [] };

    for (const key of Object.keys(next)) {
      this.overrides[key] = next[key];
    }
    this._file.save(this.overrides);
    return { ok: true, applied: Object.keys(next) };
  }
}

module.exports = { SettingsStore };