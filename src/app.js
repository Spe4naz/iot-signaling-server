'use strict';

const http = require('http');
const { DeviceRegistry } = require('./registry');
const { AlertStore } = require('./alerts');
const { RuleStore } = require('./rules');
const { SettingsStore } = require('./settings');
const { MetricsCollector } = require('./metrics');
const { StabilityStore } = require('./stability');
const session = require('./session');
const { staticHandler } = require('./static');
const config = require('./config');

const VERSION = config.version;
const API = config.apiPrefix;
const PANEL_PATH = config.panel.path;

// Login brute-force guard (independent bucket, not user-tunable).
const RATE_LOGIN = 5;

/* ---------- helpers ---------- */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseUrl(req) {
  const [path, queryString] = req.url.split('?');
  const params = new URLSearchParams(queryString || '');
  return { path, params };
}

function clientIp(req) {
  return String(req.socket.remoteAddress || 'unknown');
}

/**
 * Assemble the full HTTP server (routes, stores, rate limiting, web panel).
 * The caller decides whether/what to listen on.
 */
function createServer() {
  const settings = new SettingsStore();
  const stability = new StabilityStore({ file: config.stability.file, maxEvents: config.stability.maxEvents });
  const registry = new DeviceRegistry({
    settings,
    onStatusChange: (device, previousStatus) => {
      if (previousStatus === device.status) return;
      stability.record(device.id, device.status);
    },
  });
  const alertStore = new AlertStore();
  const ruleStore = new RuleStore();

  // Give persisted devices a baseline in the stability journal.
  for (const d of registry.list()) {
    if (d.status === 'online') stability.ensureOnline(d.id);
    else stability.record(d.id, 'offline');
  }

  /* ---------- metrics ---------- */

  const requests = { count: 0, sumMs: 0 };
  const stats = { requests, devices: () => registry.stats() };
  const metrics = new MetricsCollector({
    file: config.metrics.file,
    intervalMs: config.metrics.intervalMs,
    hours: settings.metricsHours(),
  });
  metrics.start(stats);

  const metricsFlushTimer = setInterval(() => {
    metrics.hours = settings.metricsHours();
    metrics.flush();
    stability.flush();
  }, config.metrics.flushSeconds * 1000);
  metricsFlushTimer.unref();

  /* ---------- rate limiting ---------- */

  const buckets = new Map();
  let lastBucketPrune = 0;

  function take(ip, key, limit, windowMsOverride) {
    const now = Date.now();
    const windowMs = windowMsOverride || settings.rateLimit('window_ms') || config.rateLimit.windowMs;

    if (now - lastBucketPrune > windowMs) {
      lastBucketPrune = now;
      for (const [k, b] of buckets) {
        if (now - b.start > windowMs) buckets.delete(k);
      }
    }

    const b = buckets.get(key) || { count: 0, start: now };
    if (now - b.start > windowMs) {
      b.count = 0;
      b.start = now;
    }
    b.count += 1;
    buckets.set(key, b);
    const allowed = b.count <= limit;
    if (!allowed) console.log(`[ratelimit] blocked ${key} (${b.count}/${limit})`);
    return allowed;
  }

  function rateLimited(req, key, name) {
    const limit = settings.rateLimit(name);
    return !take(clientIp(req), key, limit != null ? limit : config.rateLimit[name]);
  }

  /* ---------- auth ---------- */

  const panelRequest = (req) => session.sessionFromReq(req) > 0;

  /** Devices-level auth: Bearer token, or open when no token is configured. */
  function apiTokenOk(req) {
    const token = settings.apiToken();
    if (!token) return true; // legacy open mode
    const header = req.headers['authorization'] || '';
    return header === `Bearer ${token}`;
  }

  /** Panel/admin access: valid panel session or a valid API token. */
  function adminOk(req) {
    if (panelRequest(req)) return true;
    return apiTokenOk(req);
  }

  /* ---------- device handlers ---------- */

  async function handleRegister(req, res) {
    if (!apiTokenOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'register:' + clientIp(req), 'register')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    if (!body.id) return sendJson(res, 400, { error: 'missing_id' });
    if (!body.ip) return sendJson(res, 400, { error: 'missing_ip' });

    const maxPerIp = settings.maxDevicesPerIp();
    if (maxPerIp > 0 && registry.countByIp(body.ip) >= maxPerIp) {
      return sendJson(res, 429, { error: 'too_many_devices_from_ip' });
    }

    const device = registry.register(body);
    if (!device) return sendJson(res, 400, { error: 'invalid_device' });

    sendJson(res, 200, { ok: true, device });
  }

  async function handleHeartbeat(req, res) {
    if (rateLimited(req, 'heartbeat:' + clientIp(req), 'heartbeat')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    const { params } = parseUrl(req);
    let id = params.get('id') || req.headers['x-device-id'] || null;

    let body = null;
    if (!id) {
      try {
        body = await readBody(req);
        id = (body && body.id) || null;
      } catch (e) {
        /* invalid json body — ignore */
      }
    }

    if (!id) return sendJson(res, 400, { error: 'missing_id' });

    if (!body) {
      try {
        body = await readBody(req);
      } catch (e) {
        body = null;
      }
    }

    const device = registry.heartbeat(id, body);
    if (!device) return sendJson(res, 404, { ok: false, error: 'not_registered' });
    sendJson(res, 200, { ok: true, device });
  }

  function handleList(req, res) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'list:' + clientIp(req), 'read')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const { params } = parseUrl(req);
    const online = params.get('online');
    const filter = {};
    if (online === 'true') filter.online = true;
    if (online === 'false') filter.online = false;
    sendJson(res, 200, registry.list(filter));
  }

  function handleGet(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'read:' + clientIp(req), 'read')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const device = registry.get(id);
    if (!device) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, device);
  }

  function handleRemove(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    const removed = registry.remove(id);
    if (!removed) return sendJson(res, 404, { error: 'not_found' });
    alertStore.removeByDevice(id);
    ruleStore.removeByDevice(id);
    stability.removeDevice(id);
    sendJson(res, 200, { ok: true });
  }

  /* ---------- alerts handlers ---------- */

  async function handleAlertsList(req, res) {
    const { params } = parseUrl(req);
    sendJson(res, 200, alertStore.list({ deviceId: params.get('device_id') }));
  }

  async function handleAlertCreate(req, res) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    const alert = alertStore.create(body);
    if (!alert) return sendJson(res, 400, { error: 'invalid_alert' });
    sendJson(res, 200, alert);
  }

  async function handleAlertUpdate(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    const alert = alertStore.update(id, body);
    if (!alert) {
      const exists = alertStore.get(id);
      return sendJson(res, exists ? 400 : 404, { error: exists ? 'invalid_alert' : 'not_found' });
    }
    sendJson(res, 200, alert);
  }

  function handleAlertDelete(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    if (!alertStore.remove(id)) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, { ok: true });
  }

  /* ---------- smart-home rule handlers ---------- */

  async function handleRulesList(req, res) {
    const { params } = parseUrl(req);
    sendJson(res, 200, ruleStore.list({ deviceId: params.get('device_id') }));
  }

  async function handleRuleCreate(req, res) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    const rule = ruleStore.create(body);
    if (!rule) return sendJson(res, 400, { error: 'invalid_rule' });
    sendJson(res, 200, rule);
  }

  async function handleRuleUpdate(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    const rule = ruleStore.update(id, body);
    if (!rule) {
      const exists = ruleStore.get(id);
      return sendJson(res, exists ? 400 : 404, { error: exists ? 'invalid_rule' : 'not_found' });
    }
    sendJson(res, 200, rule);
  }

  function handleRuleDelete(req, res, id) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    if (!ruleStore.remove(id)) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, { ok: true });
  }

  /* ---------- web panel ---------- */

  const panelStatic = staticHandler(config.panel.staticDir);

  function panelEnabled() {
    return settings.panelEnabled();
  }

  async function handlePanelLogin(req, res) {
    if (!panelEnabled()) return sendJson(res, 503, { error: 'panel_disabled' });
    if (!take(clientIp(req), 'panellogin:' + clientIp(req), RATE_LOGIN, 60_000)) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    const password = String(body.password || '');
    if (!session.timingSafeEqualStr(password, settings.panelPassword())) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    session.setCookie(res, Date.now() + settings.sessionTtlMs(), { secure });
    sendJson(res, 200, { ok: true });
  }

  function handlePanelLogout(req, res) {
    session.clearCookie(res);
    sendJson(res, 200, { ok: true });
  }

  function handlePanelSession(req, res) {
    if (!panelEnabled()) return sendJson(res, 503, { error: 'panel_disabled' });
    if (!panelRequest(req)) return sendJson(res, 401, { error: 'unauthorized' });
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      path: PANEL_PATH,
      api_token_set: Boolean(settings.apiToken()),
      panel_enabled: true,
    });
  }

  function handlePanelSystem(req, res) {
    metrics.sample(stats); // refresh the latest bucket on demand
    const s = metrics.last();
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      uptime: process.uptime(),
      node: process.version,
      system: s
        ? {
            t: s.t,
            cpu: s.cpu,
            mem: s.mem,
            load1: s.load1,
            net_rx_kb_s: s.net_rx_kb_s,
            net_tx_kb_s: s.net_tx_kb_s,
            req_min: s.req_min,
            avg_ms: s.avg_ms,
          }
        : null,
      devices: registry.stats(),
      panel: { path: PANEL_PATH, enabled: panelEnabled() },
    });
  }

  function handlePanelHistory(req, res) {
    const { params } = parseUrl(req);
    sendJson(res, 200, metrics.history(Number(params.get('points')) || 120));
  }

  function enrichDevice(d) {
    const alerts = alertStore.list({ deviceId: d.id });
    const rules = ruleStore.list({ deviceId: d.id });
    return {
      ...d,
      uptime24: stability.uptime24h(d.id, d.status),
      alerts: alerts.length,
      rules: rules.length,
    };
  }

  function handlePanelDevices(req, res) {
    const { params } = parseUrl(req);
    const online = params.get('online');
    const filter = {};
    if (online === 'true') filter.online = true;
    if (online === 'false') filter.online = false;

    const q = (params.get('q') || '').toLowerCase();
    const devices = registry
      .list(filter)
      .filter(
        (d) =>
          !q ||
          d.id.toLowerCase().includes(q) ||
          String(d.name || '').toLowerCase().includes(q) ||
          String(d.type || '').toLowerCase().includes(q),
      )
      .map(enrichDevice);
    sendJson(res, 200, devices);
  }

  function handlePanelDeviceGet(req, res, id) {
    const d = registry.get(id);
    if (!d) return sendJson(res, 404, { error: 'not_found' });
    const uptime24 = stability.uptime24h(d.id, d.status);
    const uptime7d = stability.uptime7d(d.id, d.status);
    sendJson(res, 200, {
      device: { ...d, uptime24, uptime7d },
      stability: {
        events: stability.events(d.id),
        uptime24,
        uptime7d,
        current_status: d.status,
      },
      alerts: alertStore.list({ deviceId: d.id }),
      rules: ruleStore.list({ deviceId: d.id }),
    });
  }

  async function handlePanelDeviceCreate(req, res) {
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    const device = registry.register(body);
    if (!device) return sendJson(res, 400, { error: 'invalid_device' });
    stability.ensureOnline(device.id);
    sendJson(res, 200, { ok: true, device: enrichDevice(device) });
  }

  async function handlePanelDeviceUpdate(req, res, id) {
    if (rateLimited(req, 'write:' + clientIp(req), 'write')) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    if (!registry.get(id)) return sendJson(res, 404, { error: 'not_found' });
    const updated = registry.update(id, body);
    if (updated instanceof Error) return sendJson(res, 400, { error: 'invalid_device' });
    if (!updated) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, { ok: true, device: enrichDevice(updated) });
  }

  function handlePanelDeviceDelete(req, res, id) {
    if (!registry.remove(id)) return sendJson(res, 404, { error: 'not_found' });
    alertStore.removeByDevice(id);
    ruleStore.removeByDevice(id);
    stability.removeDevice(id);
    sendJson(res, 200, { ok: true });
  }

  function handlePanelSettingsGet(req, res) {
    const limits = {};
    for (const name of ['window_ms', 'register', 'heartbeat', 'write', 'read']) {
      limits[name] = settings.rateLimit(name);
    }
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      api_prefix: API,
      panel: { path: PANEL_PATH, enabled: panelEnabled() },
      stale_ms: settings.staleMs(),
      metrics_hours: settings.metricsHours(),
      max_devices_per_ip: settings.maxDevicesPerIp(),
      session_ttl_ms: settings.sessionTtlMs(),
      rate_limits: limits,
      api_token_set: Boolean(settings.apiToken()),
    });
  }

  async function handlePanelSettingsPut(req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    const result = settings.update(body);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    metrics.hours = settings.metricsHours();
    handlePanelSettingsGet(req, res);
  }

  function handlePanelRestart(req, res) {
    sendJson(res, 200, { ok: true });
    setTimeout(() => {
      console.log('[panel] restart requested');
      registry.flush();
      stability.flush();
      metrics.flush();
      process.exit(0);
    }, 250);
  }

  async function handlePanelApi(req, res, subPath) {
    const method = req.method;
    const [head, tail] = subPath.split('/');

    if (head === 'auth') {
      if (tail === 'login' && method === 'POST') return handlePanelLogin(req, res);
      if (tail === 'logout' && method === 'POST') return handlePanelLogout(req, res);
      if (tail === 'session' && method === 'GET') return handlePanelSession(req, res);
      return sendJson(res, 404, { error: 'not_found' });
    }

    // Convenience alias: GET /panel/api/session
    if (head === 'session' && !tail && method === 'GET') return handlePanelSession(req, res);

    // Everything below requires a live panel session (or api token).
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });

    if (head === 'system') {
      if (tail === 'history' && method === 'GET') return handlePanelHistory(req, res);
      if (!tail && method === 'GET') return handlePanelSystem(req, res);
      return sendJson(res, 404, { error: 'not_found' });
    }

    if (head === 'settings') {
      if (!tail && method === 'GET') return handlePanelSettingsGet(req, res);
      if (!tail && method === 'PUT') return handlePanelSettingsPut(req, res);
      return sendJson(res, 404, { error: 'not_found' });
    }

    if (head === 'restart' && !tail && method === 'POST') return handlePanelRestart(req, res);

    if (head === 'devices') {
      if (!tail && method === 'GET') return handlePanelDevices(req, res);
      if (!tail && method === 'POST') return handlePanelDeviceCreate(req, res);
      if (tail) {
        let id;
        try {
          id = decodeURIComponent(tail);
        } catch {
          return sendJson(res, 400, { error: 'bad_device_id' });
        }
        if (method === 'GET') return handlePanelDeviceGet(req, res, id);
        if (method === 'PUT') return handlePanelDeviceUpdate(req, res, id);
        if (method === 'DELETE') return handlePanelDeviceDelete(req, res, id);
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  /* ---------- router ---------- */

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(`[err] ${req.method} ${req.url}:`, err);
      if (res.headersSent) return res.destroy();
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  async function handleRequest(req, res) {
    const started = Date.now();
    const originalEnd = res.end.bind(res);
    let logged = false;
    res.end = (...args) => {
      if (!logged) {
        logged = true;
        requests.count += 1;
        requests.sumMs += Date.now() - started;
        console.log(`[req] ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - started}ms`);
      }
      return originalEnd(...args);
    };

    const { path } = parseUrl(req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    // Simple root info
    if (path === '/' || path === '') {
      return sendText(res, 200, `IoT Modular System - Signaling Server v${VERSION}\nAPI: ${API}\nPanel: ${PANEL_PATH}\n`);
    }

    if (req.method === 'GET' && path === API + '/health') {
      const { total, online, offline } = registry.stats();
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        uptime: process.uptime(),
        devices: { total, online, offline },
        alerts: alertStore.list().length,
        rules: ruleStore.list().length,
      });
    }

    if (req.method === 'GET' && path === API + '/meta') {
      return sendJson(res, 200, {
        version: VERSION,
        stale_ms: settings.staleMs(),
        rate_limits: {
          window_ms: settings.rateLimit('window_ms'),
          register: settings.rateLimit('register'),
          heartbeat: settings.rateLimit('heartbeat'),
          write: settings.rateLimit('write'),
          read: settings.rateLimit('read'),
        },
        auth_enabled: settings.apiToken().length > 0,
        max_devices_per_ip: settings.maxDevicesPerIp(),
      });
    }

    if (req.method === 'POST' && path === API + '/devices/register') {
      return handleRegister(req, res);
    }

    if (req.method === 'POST' && path === API + '/devices/heartbeat') {
      return handleHeartbeat(req, res);
    }

    if (req.method === 'GET' && path === API + '/devices') {
      return handleList(req, res);
    }

    // Alerts collection
    if (path === API + '/alerts') {
      if (req.method === 'GET') return handleAlertsList(req, res);
      if (req.method === 'POST') return handleAlertCreate(req, res);
    }

    // /api/v1/alerts/:id
    const alertMatch = path.match(new RegExp('^' + API + '/alerts/([^/]+)$'));
    if (alertMatch) {
      let id;
      try {
        id = decodeURIComponent(alertMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'bad_alert_id' });
        return;
      }
      if (req.method === 'PUT') return handleAlertUpdate(req, res, id);
      if (req.method === 'DELETE') return handleAlertDelete(req, res, id);
    }

    // Smart-home rules collection
    if (path === API + '/rules') {
      if (req.method === 'GET') return handleRulesList(req, res);
      if (req.method === 'POST') return handleRuleCreate(req, res);
    }

    // /api/v1/rules/:id
    const ruleMatch = path.match(new RegExp('^' + API + '/rules/([^/]+)$'));
    if (ruleMatch) {
      let id;
      try {
        id = decodeURIComponent(ruleMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'bad_rule_id' });
        return;
      }
      if (req.method === 'PUT') return handleRuleUpdate(req, res, id);
      if (req.method === 'DELETE') return handleRuleDelete(req, res, id);
    }

    // /api/v1/devices/:id
    const deviceMatch = path.match(new RegExp('^' + API + '/devices/([^/]+)$'));
    if (deviceMatch) {
      let id;
      try {
        id = decodeURIComponent(deviceMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'bad_device_id' });
        return;
      }
      if (req.method === 'GET') return handleGet(req, res, id);
      if (req.method === 'DELETE') return handleRemove(req, res, id);
    }

    /* ---------- web panel ---------- */

    if (path === PANEL_PATH) {
      res.writeHead(301, { Location: PANEL_PATH + '/', ...SECURITY_HEADERS });
      return res.end();
    }

    if (path.startsWith(PANEL_PATH + '/api/')) {
      const subPath = path.slice((PANEL_PATH + '/api/').length);
      return handlePanelApi(req, res, subPath);
    }

    if (path.startsWith(PANEL_PATH + '/')) {
      const handled = panelStatic(req, res, path.slice(PANEL_PATH.length));
      if (handled) return;
      return sendJson(res, 404, { error: 'not_found' });
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  return { server, registry, alertStore, ruleStore, settings, metrics, stability };
}

module.exports = { createServer };