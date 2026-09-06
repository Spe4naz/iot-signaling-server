'use strict';

const http = require('http');
const { DeviceRegistry } = require('./registry');
const { AlertStore } = require('./alerts');

const VERSION = require('../package.json').version;
const API = '/api/v1';

// Optional write token — when set, register/delete/alerts writes require:
//   Authorization: Bearer <token>
const REGISTER_TOKEN = process.env.REGISTER_TOKEN || '';

// In-memory rate limiting (per IP, sliding window)
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_REGISTER = Number(process.env.RATE_LIMIT_REGISTER) || 20;   // /min
const RATE_HEARTBEAT = Number(process.env.RATE_LIMIT_HEARTBEAT) || 120; // /min
const RATE_WRITE = Number(process.env.RATE_LIMIT_WRITE) || 60;          // /min

// Anti-spam: max devices from a single origin IP
const MAX_DEVICES_PER_IP = Number(process.env.MAX_DEVICES_PER_IP) || 20;

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
 * Assemble the full HTTP server (routes, stores, rate limiting).
 * The caller decides whether/what to listen on.
 */
function createServer() {
  const registry = new DeviceRegistry();
  const alertStore = new AlertStore();

  /* ---------- rate limiting ---------- */

  const buckets = new Map();
  let lastBucketPrune = 0;

  function take(ip, key, limit) {
    const now = Date.now();

    // Prune stale buckets once per window so a flood of unique IPs (IPv6
    // rotation, NAT churn) can't grow the map without bound.
    if (now - lastBucketPrune > RATE_WINDOW_MS) {
      lastBucketPrune = now;
      for (const [k, b] of buckets) {
        if (now - b.start > RATE_WINDOW_MS) buckets.delete(k);
      }
    }

    const b = buckets.get(key) || { count: 0, start: now };
    if (now - b.start > RATE_WINDOW_MS) {
      b.count = 0;
      b.start = now;
    }
    b.count += 1;
    buckets.set(key, b);
    const allowed = b.count <= limit;
    if (!allowed) console.log(`[ratelimit] blocked ${key} (${b.count}/${limit})`);
    return allowed;
  }

  function rateLimited(req, key, limit) {
    return !take(clientIp(req), key, limit);
  }

  function authOk(req) {
    if (!REGISTER_TOKEN) return true;
    const header = req.headers['authorization'] || '';
    return header === `Bearer ${REGISTER_TOKEN}`;
  }

  /* ---------- handlers ---------- */

  async function handleRegister(req, res) {
    if (!authOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'register:' + clientIp(req), RATE_REGISTER)) {
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

    if (MAX_DEVICES_PER_IP > 0 && registry.countByIp(body.ip) >= MAX_DEVICES_PER_IP) {
      return sendJson(res, 429, { error: 'too_many_devices_from_ip' });
    }

    const device = registry.register(body);
    if (!device) return sendJson(res, 400, { error: 'invalid_device' });

    sendJson(res, 200, { ok: true, device });
  }

  async function handleHeartbeat(req, res) {
    if (rateLimited(req, 'heartbeat:' + clientIp(req), RATE_HEARTBEAT)) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    const { params } = parseUrl(req);
    let id = params.get('id') || req.headers['x-device-id'] || null;

    if (!id) {
      try {
        const body = await readBody(req);
        id = (body && body.id) || null;
      } catch (e) {
        /* invalid json body — ignore */
      }
    }

    if (!id) return sendJson(res, 400, { error: 'missing_id' });

    const device = registry.heartbeat(id);
    if (!device) return sendJson(res, 404, { ok: false, error: 'not_registered' });
    sendJson(res, 200, { ok: true, device });
  }

  function handleList(req, res) {
    const { params } = parseUrl(req);
    const online = params.get('online');
    const filter = {};
    if (online === 'true') filter.online = true;
    if (online === 'false') filter.online = false;
    sendJson(res, 200, registry.list(filter));
  }

  function handleGet(req, res, id) {
    const device = registry.get(id);
    if (!device) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, device);
  }

  function handleRemove(req, res, id) {
    if (!authOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), RATE_WRITE)) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    const removed = registry.remove(id);
    if (!removed) return sendJson(res, 404, { error: 'not_found' });
    alertStore.removeByDevice(id);
    sendJson(res, 200, { ok: true });
  }

  /* ---------- alerts handlers ---------- */

  async function handleAlertsList(req, res) {
    const { params } = parseUrl(req);
    sendJson(res, 200, alertStore.list({ deviceId: params.get('device_id') }));
  }

  async function handleAlertCreate(req, res) {
    if (!authOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), RATE_WRITE)) {
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
    if (!authOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), RATE_WRITE)) {
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
    if (!authOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (rateLimited(req, 'write:' + clientIp(req), RATE_WRITE)) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    if (!alertStore.remove(id)) return sendJson(res, 404, { error: 'not_found' });
    sendJson(res, 200, { ok: true });
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
      return sendText(res, 200, `IoT Modular System - Signaling Server v${VERSION}\nAPI: ${API}\n`);
    }

    if (req.method === 'GET' && path === API + '/health') {
      const { total, online, offline } = registry.stats();
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        uptime: process.uptime(),
        devices: { total, online, offline },
        alerts: alertStore.list().length,
      });
    }

    if (req.method === 'GET' && path === API + '/meta') {
      return sendJson(res, 200, {
        version: VERSION,
        stale_ms: Number(process.env.STALE_MS) || 180_000,
        rate_limits: { window_ms: RATE_WINDOW_MS, register: RATE_REGISTER, heartbeat: RATE_HEARTBEAT, write: RATE_WRITE },
        auth_enabled: Boolean(REGISTER_TOKEN),
        max_devices_per_ip: MAX_DEVICES_PER_IP,
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

    sendJson(res, 404, { error: 'not_found' });
  }

  return { server, registry, alertStore };
}

module.exports = { createServer };