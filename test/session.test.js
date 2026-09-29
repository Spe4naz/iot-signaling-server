'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-session-'));
process.env.REGISTRY_FILE = path.join(tmp, 'devices.json');
process.env.ALERTS_FILE = path.join(tmp, 'alerts.json');
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.PANEL_PASSWORD = 'panel-secret';

const session = require('../src/session');

test('sign/verify roundtrip', () => {
  const exp = Date.now() + 60_000;
  const token = session.sign(exp);
  assert.equal(session.verify(token), exp);
});

test('verify rejects expired tokens', () => {
  const token = session.sign(Date.now() - 1000);
  assert.equal(session.verify(token), 0);
});

test('verify rejects tampered tokens', () => {
  const token = session.sign(Date.now() + 60_000);
  const [body, sig] = token.split('.');
  assert.equal(session.verify(`${body}a.${sig}`), 0);
  assert.equal(session.verify(`x.${sig}`), 0);
  assert.equal(session.verify(`${body}.${sig}a`), 0);
});

test('verify invalid input → 0', () => {
  assert.equal(session.verify(null), 0);
  assert.equal(session.verify(''), 0);
  assert.equal(session.verify('garbage'), 0);
});

test('sessionFromReq reads cookie header', () => {
  const exp = Date.now() + 60_000;
  const token = session.sign(exp);
  const req = { headers: { cookie: `foo=1; iot_panel=${token}; bar=2` } };
  assert.equal(session.sessionFromReq(req), exp);
  assert.equal(session.sessionFromReq({ headers: {} }), 0);
});

function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

test('setCookie sets HttpOnly cookie with expiring max-age', () => {
  const res = fakeRes();
  session.setCookie(res, Date.now() + 10_000, { secure: false });
  const header = res.headers['Set-Cookie'];
  assert.match(header, /iot_panel=/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=/);
  assert.doesNotMatch(header, /Secure/);

  const res2 = fakeRes();
  session.setCookie(res2, Date.now() + 10_000, { secure: true });
  assert.match(res2.headers['Set-Cookie'], /Secure/);
});

test('clearCookie invalidates', () => {
  const res = fakeRes();
  session.clearCookie(res);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});

test('timingSafeEqualStr', () => {
  assert.equal(session.timingSafeEqualStr('abc', 'abc'), true);
  assert.equal(session.timingSafeEqualStr('abc', 'abd'), false);
  assert.equal(session.timingSafeEqualStr('', 'x'), false);
});