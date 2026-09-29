'use strict';

const crypto = require('crypto');

/**
 * Panel session tokens — stateless HMAC-signed cookies.
 *
 * The token is `base64url(exp_ms).base64url(hmac)` where the HMAC key is
 * derived from the panel password (falling back to the API token). Expiry is
 * checked on every verify, so sessions can't outlive the TTL even if the
 * secret changes later.
 */
const COOKIE = 'iot_panel';

function secret() {
  const src = require('./config');
  const keyMaterial = src.panel.password || src.auth.registerToken || '';
  return crypto.createHash('sha256').update(`iot-panel:${keyMaterial}`).digest();
}

function sign(exp) {
  const body = Buffer.from(String(exp), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string') return 0;
  const dot = token.indexOf('.');
  if (dot === -1) return 0;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return 0;

  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 0;

  const exp = Number(Buffer.from(body, 'base64url').toString('utf8'));
  if (!Number.isFinite(exp)) return 0;
  return Date.now() < exp ? exp : 0;
}

/** Read the panel cookie from a request; returns 0 when missing/invalid/expired. */
function sessionFromReq(req) {
  const header = req.headers['cookie'] || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === COOKIE) return verify(part.slice(idx + 1).trim());
  }
  return 0;
}

function setCookie(res, exp, { secure } = {}) {
  const ttlSec = Math.max(1, Math.floor((exp - Date.now()) / 1000));
  const parts = [
    `${COOKIE}=${sign(exp)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ttlSec}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Constant-time password comparison. */
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { COOKIE, sign, verify, sessionFromReq, setCookie, clearCookie, timingSafeEqualStr };