'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny static file serving for the built web panel (web/dist).
 * No external deps, path-traversal safe, SPA fallback to index.html.
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(res, filePath, { immutable = false } = {}) {
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  };
  headers['Cache-Control'] = immutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, headers);
  res.end(data);
  return true;
}

function resolveWithin(base, urlPath) {
  const rel = String(urlPath || '').replace(/^\/+/, '');
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * SPA static handler: resolves `urlPath` inside `baseDir`, falls back to
 * index.html for non-file/routing paths. Returns true when it handled the
 * request.
 */
function staticHandler(baseDir, { index = 'index.html' } = {}) {
  return function handle(req, res, urlPath) {
    let full = resolveWithin(baseDir, urlPath);
    if (!full) return false;

    let st = null;
    try {
      st = fs.statSync(full);
    } catch {
      st = null;
    }
    if (st && st.isDirectory()) full = path.join(full, index);

    let isFile = false;
    try {
      isFile = fs.statSync(full).isFile();
    } catch {
      isFile = false;
    }

    if (!isFile) {
      const fallback = resolveWithin(baseDir, index);
      if (!fallback) return false;
      return serveFile(res, fallback);
    }

    const basename = path.basename(full);
    const immutable = /\/assets\/|\/_assets\/|\/static\//.test(urlPath) && basename !== index;
    return serveFile(res, full, { immutable });
  };
}

module.exports = { serveFile, staticHandler, MIME };