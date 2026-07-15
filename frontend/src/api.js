const API_BASE = '/api/v1';
const SESSION_EVENT = 'exam-session-change';
const SESSION_META_KEY = 'sessionMeta';
const SESSION_KEYS = ['accessToken', 'refreshToken', 'currentUser', SESSION_META_KEY];
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const RECENT_ACTIVITY_MS = 30 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 15 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

let refreshingSession = null;
let lastActivityWriteAt = 0;
let lastHeartbeatAt = 0;

function notifySessionChange(reason = 'updated') {
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason, user: getCurrentUser() } }));
}

function storeHasSession(store) {
  return Boolean(store.getItem('accessToken') || store.getItem('refreshToken'));
}

function getSessionStore() {
  if (storeHasSession(localStorage)) return localStorage;
  if (storeHasSession(sessionStorage)) return sessionStorage;
  return null;
}

function readSessionMeta(store = getSessionStore()) {
  if (!store) return null;
  try {
    return JSON.parse(store.getItem(SESSION_META_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSessionMeta(store, meta) {
  store.setItem(SESSION_META_KEY, JSON.stringify(meta));
}

export function getToken() {
  return getSessionStore()?.getItem('accessToken') ?? null;
}

export function getRefreshToken() {
  return getSessionStore()?.getItem('refreshToken') ?? null;
}

export function getCurrentUser() {
  const store = getSessionStore();
  const raw = store?.getItem('currentUser');
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    clearSession('invalid');
    return null;
  }
}

export function setSession(data, options = {}) {
  const previousStore = getSessionStore();
  const previousMeta = readSessionMeta(previousStore);
  const previousUser = getCurrentUser();
  const rememberMe = options.rememberMe ?? data.session?.rememberMe ?? previousMeta?.rememberMe ?? true;
  const store = rememberMe ? localStorage : sessionStorage;
  const otherStore = rememberMe ? sessionStorage : localStorage;
  const now = Date.now();
  const lastActivityAt = options.preserveActivity && previousMeta?.lastActivityAt
    ? previousMeta.lastActivityAt
    : now;

  SESSION_KEYS.forEach((key) => otherStore.removeItem(key));
  if (previousStore && previousStore !== store) {
    SESSION_KEYS.forEach((key) => previousStore.removeItem(key));
  }

  if (data.accessToken) store.setItem('accessToken', data.accessToken);
  if (data.refreshToken) store.setItem('refreshToken', data.refreshToken);

  const user = data.user ?? previousUser;
  if (user) store.setItem('currentUser', JSON.stringify(user));

  writeSessionMeta(store, {
    rememberMe,
    lastActivityAt,
    idleTimeoutMs: data.session?.idleTimeoutMs ?? previousMeta?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    expiresAt: data.session?.expiresAt ?? previousMeta?.expiresAt ?? null,
  });
  notifySessionChange('updated');
}

export function clearSession(reason = 'logout') {
  SESSION_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  notifySessionChange(reason);
}

export function hasActiveSession() {
  const store = getSessionStore();
  if (!store) return false;

  let meta = readSessionMeta(store);
  if (!meta) {
    meta = {
      rememberMe: store === localStorage,
      lastActivityAt: Date.now(),
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      expiresAt: null,
    };
    writeSessionMeta(store, meta);
  }

  const idleTimeoutMs = Number(meta.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS;
  const idleExpired = Date.now() - Number(meta.lastActivityAt || 0) > idleTimeoutMs;
  const absoluteExpired = meta.expiresAt && new Date(meta.expiresAt).getTime() <= Date.now();
  if (idleExpired || absoluteExpired) {
    clearSession('expired');
    return false;
  }

  return true;
}

export function onSessionChange(handler) {
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

export function startSessionActivityMonitor() {
  const recordActivity = (event) => {
    if (event && event.isTrusted === false) return;
    if (!hasActiveSession()) return;

    const now = Date.now();
    const store = getSessionStore();
    const meta = readSessionMeta(store);
    if (store && meta && now - lastActivityWriteAt >= ACTIVITY_WRITE_INTERVAL_MS) {
      writeSessionMeta(store, { ...meta, lastActivityAt: now });
      lastActivityWriteAt = now;
    }

    if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatAt = now;
      void apiWire('/auth/activity', { method: 'POST', markActivity: true }).catch(() => undefined);
    }
  };

  const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  events.forEach((eventName) => window.addEventListener(eventName, recordActivity, { capture: true, passive: true }));
  const syncStorage = (event) => {
    if (event.key && SESSION_KEYS.includes(event.key)) {
      notifySessionChange(getSessionStore() ? 'updated' : 'logout');
    }
  };
  window.addEventListener('storage', syncStorage);
  const timer = window.setInterval(() => hasActiveSession(), ACTIVITY_WRITE_INTERVAL_MS);

  return () => {
    events.forEach((eventName) => window.removeEventListener(eventName, recordActivity, true));
    window.removeEventListener('storage', syncStorage);
    window.clearInterval(timer);
  };
}

export async function apiWire(url, options = {}) {
  const { auth = true, markActivity = false, ...requestOptions } = options;
  const path = normalizeApiPath(url);

  try {
    if (auth && path !== '/auth/refresh') {
      await refreshSessionIfNeeded();
    }
    return await requestWire(path, requestOptions, { auth, markActivity });
  } catch (error) {
    if (!auth || !isUnauthorized(error) || path === '/auth/refresh') {
      throw error;
    }

    await refreshSession();
    return requestWire(path, requestOptions, { auth, markActivity });
  }
}

async function requestWire(path, options = {}, sessionOptions = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers ?? {}),
  };
  const token = sessionOptions.auth === false ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (token && (sessionOptions.markActivity || hasRecentActivity())) headers['X-Session-Activity'] = '1';

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined && !isFormData && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      const error = new Error(`请求失败：${response.status}`);
      error.status = response.status;
      throw error;
    }
    return {
      data: response.status === 204 ? null : await response.blob(),
      status: response.status,
      headers: response.headers,
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== 0) {
    const error = new Error(payload?.message || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function normalizeApiPath(url) {
  const value = String(url || '');
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value, window.location.origin);
    return normalizeApiPath(`${parsed.pathname}${parsed.search}`);
  }
  const path = value.startsWith(API_BASE)
    ? value.slice(API_BASE.length) || '/'
    : value.startsWith('/') ? value : `/${value}`;
  const [pathname, query = ''] = path.split('?', 2);
  if (!query) return pathname;
  const params = new URLSearchParams(query);
  for (const [key, parameter] of [...params.entries()]) {
    if (parameter === '' || parameter === 'null' || parameter === 'undefined') params.delete(key);
  }
  const normalizedQuery = params.toString();
  return normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken || !hasActiveSession()) {
    clearSession('expired');
    throw new Error('登录已过期，请重新登录');
  }

  if (!refreshingSession) {
    const recentActivity = hasRecentActivity();
    refreshingSession = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(recentActivity ? { 'X-Session-Activity': '1' } : {}),
      },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.code !== 0) {
          const error = new Error(payload?.message || '登录已过期，请重新登录');
          error.status = response.status;
          throw error;
        }
        setSession(payload.data, { preserveActivity: !recentActivity });
        return payload.data;
      })
      .catch((error) => {
        if (isUnauthorized(error)) clearSession('expired');
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

function hasRecentActivity() {
  const meta = readSessionMeta();
  return Boolean(meta?.lastActivityAt && Date.now() - Number(meta.lastActivityAt) <= RECENT_ACTIVITY_MS);
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
