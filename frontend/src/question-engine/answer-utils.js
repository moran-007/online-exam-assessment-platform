const LANGUAGE_LABELS = {
  'cc.cc17o2': 'C++17(O2)',
  'cc.cc17': 'C++17',
  'cc.cc14o2': 'C++14(O2)',
  'cc.cc14': 'C++14',
  'cc.cc11o2': 'C++11(O2)',
  'cc.cc11': 'C++11',
  'py.py3': 'Python 3',
  'py.py2': 'Python 2',
  'cc.cc20o2': 'C++20(O2)',
  'cc.cc20': 'C++20',
  java: 'Java',
  c: 'C',
  cc: 'C++',
  pas: 'Pascal',
};

export function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
}

export function languageLabel(language, aliases = {}) {
  return aliases[language] ?? LANGUAGE_LABELS[language] ?? language;
}

export function programmingRefBaseUrl(ref) {
  return normalizeBaseUrl(ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl));
}

export function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  return raw ? (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '') : '';
}

export function shortHost(value) {
  try {
    return new URL(normalizeBaseUrl(value)).host;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

export function sameHydroBaseUrl(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

export function hydroAccountLabel(account) {
  return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
}

function baseUrlFromProblemUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function canonicalHost(value) {
  return shortHost(value).toLowerCase().replace(/^www\./, '');
}
