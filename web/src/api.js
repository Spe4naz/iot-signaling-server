import { evict } from './store';

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json */
  }

  if (res.status === 401 && path !== '/panel/api/auth/login') {
    const isSessionProbe = path.endsWith('/session');
    if (!isSessionProbe) {
      evict();
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/panel/';
      }
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // panel session
  login: (password) => request('/panel/api/auth/login', { method: 'POST', body: { password } }),
  logout: () => request('/panel/api/auth/logout', { method: 'POST' }),
  session: () => request('/panel/api/session'),

  // system
  system: () => request('/panel/api/system'),
  history: (points = 120) => request(`/panel/api/system/history?points=${points}`),

  // settings / maintenance
  settings: () => request('/panel/api/settings'),
  saveSettings: (patch) => request('/panel/api/settings', { method: 'PUT', body: patch }),
  restart: () => request('/panel/api/restart', { method: 'POST' }),

  // devices
  devices: (q = '', online = '') =>
    request(`/panel/api/devices?q=${encodeURIComponent(q)}${online ? `&online=${online}` : ''}`),
  device: (id) => request(`/panel/api/devices/${encodeURIComponent(id)}`),
  createDevice: (b) => request('/panel/api/devices', { method: 'POST', body: b }),
  updateDevice: (id, b) => request(`/panel/api/devices/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  deleteDevice: (id) => request(`/panel/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // alerts (same-origin /api/v1, authed by panel cookie)
  alerts: () => request('/api/v1/alerts'),
  createAlert: (b) => request('/api/v1/alerts', { method: 'POST', body: b }),
  updateAlert: (id, b) => request(`/api/v1/alerts/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  deleteAlert: (id) => request(`/api/v1/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // smart-home rules
  rules: () => request('/api/v1/rules'),
  createRule: (b) => request('/api/v1/rules', { method: 'POST', body: b }),
  updateRule: (id, b) => request(`/api/v1/rules/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  deleteRule: (id) => request(`/api/v1/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};