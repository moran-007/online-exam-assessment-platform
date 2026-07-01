const API_BASE = '/api/v1';
let refreshingSession = null;
const SESSION_EVENT = 'moran-session-change';

function notifySessionChange() {
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { user: getCurrentUser() } }));
}

export function getToken() {
  return localStorage.getItem('accessToken');
}

export function getRefreshToken() {
  return localStorage.getItem('refreshToken');
}

export function getCurrentUser() {
  const raw = localStorage.getItem('currentUser');
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }
}

export function setSession(data) {
  if (data.accessToken) {
    localStorage.setItem('accessToken', data.accessToken);
  }
  if (data.refreshToken) {
    localStorage.setItem('refreshToken', data.refreshToken);
  }
  const user = data.user ?? getCurrentUser();
  if (user) {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }
  notifySessionChange();
}

export function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  notifySessionChange();
}

export function onSessionChange(handler) {
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

export async function api(path, options = {}) {
  try {
    if (path !== '/auth/refresh') {
      await refreshSessionIfNeeded();
    }
    return await request(path, options);
  } catch (error) {
    if (!isUnauthorized(error) || path === '/auth/refresh') {
      throw error;
    }

    await refreshSession();
    return request(path, options);
  }
}

async function request(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers ?? {}),
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.code !== 0) {
    const error = new Error(payload?.message || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload.data;
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    throw new Error('登录已过期，请重新登录');
  }

  if (!refreshingSession) {
    refreshingSession = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.code !== 0) {
          throw new Error(payload?.message || '登录已过期，请重新登录');
        }
        setSession(payload.data);
        return payload.data;
      })
      .catch((error) => {
        clearSession();
        throw error;
      })
      .finally(() => {
        refreshingSession = null;
      });
  }

  return refreshingSession;
}

async function refreshSessionIfNeeded() {
  const token = getToken();
  if (!token || !isTokenExpiringSoon(token)) return;
  await refreshSession();
}

function isTokenExpiringSoon(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  const expiresAt = Number(payload.exp) * 1000;
  return Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000;
}

function decodeJwtPayload(token) {
  const [, rawPayload] = token.split('.');
  if (!rawPayload) return null;
  try {
    const normalized = rawPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isUnauthorized(error) {
  return error?.status === 401 || /登录|token|Unauthorized/i.test(error?.message ?? '');
}

export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}
