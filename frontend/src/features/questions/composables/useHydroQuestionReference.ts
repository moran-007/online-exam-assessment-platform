import type { ComputedRef, Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { listMyHydroAccounts, pullHydroProblem } from '../../hydro/api';
import type { HydroAccountView, HydroPulledProblem } from '../../hydro/models';
import type {
  HydroSiteOption,
  ProgrammingReference,
  SingleQuestionForm,
} from '../models';

type ProgrammingRefInput = {
  judgeProvider?: unknown;
  externalProblemId?: unknown;
  externalProblemUrl?: unknown;
  platformBaseUrl?: unknown;
  domainId?: unknown;
  domainName?: unknown;
  accountId?: unknown;
  accountLabel?: unknown;
  languagesText?: unknown;
  timeLimit?: unknown;
  memoryLimit?: unknown;
  judgeConfig?: unknown;
};

type HydroState = {
  singleForm: SingleQuestionForm;
  hydroAccounts: Ref<HydroAccountView[]>;
  hydroSiteOptions: ComputedRef<HydroSiteOption[]>;
  selectedSingleHydroAccount: ComputedRef<HydroAccountView | null>;
  singleHydroProblemUrl: ComputedRef<string>;
  canPullSingleHydroProblem: ComputedRef<boolean>;
  singleHydroPulling: Ref<boolean>;
  resetSingleOptions: () => void;
  refreshPreview: () => void;
  scheduleSingleDuplicateCheck: () => void;
};

export function useHydroQuestionReference(state: HydroState) {
  const {
    canPullSingleHydroProblem,
    hydroAccounts,
    hydroSiteOptions,
    refreshPreview,
    resetSingleOptions,
    scheduleSingleDuplicateCheck,
    selectedSingleHydroAccount,
    singleForm,
    singleHydroProblemUrl,
    singleHydroPulling,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  function formatHydroDomainLabel(ref: ProgrammingReference) {
    const domainId = String(ref?.domainId || '').trim();
    const domainName = String(ref?.domainName || '').trim();
    if (domainId && domainName && domainName !== domainId && domainName !== 'system') {
      return `${domainId} / ${domainName}`;
    }
    return domainId || domainName || 'system';
  }

  async function loadHydroAccounts() {
    try {
      const data = await listMyHydroAccounts();
      hydroAccounts.value = data;
      syncSingleHydroAccountForSite();
    } catch {
      hydroAccounts.value = [];
    }
  }

  function handleSingleHydroAccountChange(accountId: string) {
    const account = hydroAccounts.value.find((item) => item.id === accountId);
    if (!account) {
      singleForm.programmingRef.accountLabel = '';
      return;
    }
    singleForm.programmingRef.platformBaseUrl = account.platformBaseUrl || singleForm.programmingRef.platformBaseUrl;
    singleForm.programmingRef.judgeProvider = account.platformCode || singleForm.programmingRef.judgeProvider || 'hydro';
    singleForm.programmingRef.accountLabel = `${account.loginUsername || account.hydroUsername}@${shortHost(account.platformBaseUrl)}`;
  }

  function handleSingleHydroSiteChange(value: string) {
    applyHydroSiteToRef(singleForm.programmingRef, value);
    if (
      singleForm.programmingRef.externalProblemUrl &&
      value &&
      !sameHydroBaseUrl(singleForm.programmingRef.externalProblemUrl, value)
    ) {
      singleForm.programmingRef.externalProblemUrl = '';
    }
    syncSingleHydroAccountForSite();
  }

  function handleSingleHydroProblemInputChange() {
    normalizeHydroProblemInput(singleForm.programmingRef);
    syncSingleHydroAccountForSite();
    refreshPreview();
  }

  function normalizeHydroProblemInput(ref: ProgrammingReference) {
    const raw = String(ref.externalProblemId || '').trim();
    if (!raw) {
      ref.externalProblemUrl = '';
      return;
    }
    const parsed = parseHydroProblemUrl(raw);
    if (parsed) {
      ref.externalProblemId = parsed.problemId || raw;
      ref.externalProblemUrl = parsed.url;
      applyHydroSiteToRef(ref, parsed.baseUrl);
      if (parsed.domainId) {
        ref.domainId = parsed.domainId;
        ref.domainName = parsed.domainId;
      }
      return;
    }

    ref.externalProblemId = cleanHydroProblemId(raw);
    const explicitProblemId = problemIdFromHydroUrl(ref.externalProblemUrl);
    if (explicitProblemId && explicitProblemId !== ref.externalProblemId) {
      ref.externalProblemUrl = '';
    }
  }

  function applyHydroSiteToRef(ref: ProgrammingReference, value: string) {
    const normalized = normalizeBaseUrl(value || ref.platformBaseUrl);
    const site = hydroSiteOptions.value.find((item) => sameHydroBaseUrl(item.value, normalized));
    ref.platformBaseUrl = site?.value || normalized;
    ref.judgeProvider = site?.judgeProvider || matchingHydroAccountForSite(ref.platformBaseUrl)?.platformCode || ref.judgeProvider || 'hydro';
  }

  function syncSingleHydroAccountForSite() {
    const account = selectedSingleHydroAccount.value;
    if (account && sameHydroBaseUrl(account.platformBaseUrl, singleForm.programmingRef.platformBaseUrl)) {
      handleSingleHydroAccountChange(account.id);
      return;
    }
    const nextAccount = matchingHydroAccountForSite(singleForm.programmingRef.platformBaseUrl);
    singleForm.programmingRef.accountId = nextAccount?.id || '';
    singleForm.programmingRef.accountLabel = nextAccount
      ? `${nextAccount.loginUsername || nextAccount.hydroUsername}@${shortHost(nextAccount.platformBaseUrl)}`
      : '';
    if (nextAccount?.platformCode) {
      singleForm.programmingRef.judgeProvider = nextAccount.platformCode;
    }
  }

  function matchingHydroAccountForSite(baseUrl: string) {
    return hydroAccounts.value.find((account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
      || hydroAccounts.value.find((account) => sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
      || null;
  }

  function buildSingleProgrammingRefPayload(): ProgrammingReference | null {
    normalizeHydroProblemInput(singleForm.programmingRef);
    return buildProgrammingRefFromValues({
      judgeProvider: singleForm.programmingRef.judgeProvider,
      externalProblemId: singleForm.programmingRef.externalProblemId,
      externalProblemUrl: effectiveHydroProblemUrl(singleForm.programmingRef),
      platformBaseUrl: singleForm.programmingRef.platformBaseUrl,
      domainId: singleForm.programmingRef.domainId,
      domainName: singleForm.programmingRef.domainName,
      accountId: singleForm.programmingRef.accountId,
      accountLabel: singleForm.programmingRef.accountLabel,
      languagesText: singleForm.programmingRef.languagesText,
      timeLimit: singleForm.programmingRef.timeLimit,
      memoryLimit: singleForm.programmingRef.memoryLimit,
      judgeConfig: singleForm.programmingRef.judgeConfig,
    });
  }

  function normalizeProgrammingRef(value: unknown): ProgrammingReference | null {
    const record = recordValue(value);
    if (!Object.keys(record).length) return null;
    const judgeConfig = recordValue(record.judgeConfig);
    const ref = buildProgrammingRefFromValues({
      judgeProvider: record.judgeProvider ?? record.platformCode ?? judgeConfig.platformCode,
      externalProblemId: record.externalProblemId ?? record.hydroProblemId ?? record.hydroProblemName ?? record.hydroProblem,
      externalProblemUrl: record.externalProblemUrl ?? record.hydroProblemUrl ?? record.hydroUrl,
      platformBaseUrl: record.platformBaseUrl,
      domainId: record.domainId,
      domainName: record.domainName,
      accountId: record.accountId,
      accountLabel: record.accountLabel,
      languagesText: Array.isArray(record.languages) ? record.languages.join(',') : record.languages ?? record.hydroLanguages,
      timeLimit: record.timeLimit,
      memoryLimit: record.memoryLimit,
      judgeConfig: record.judgeConfig,
    });
    return ref?.externalProblemId ? ref : null;
  }

  function buildProgrammingRefFromValues({
    judgeProvider,
    externalProblemId,
    externalProblemUrl,
    platformBaseUrl,
    domainId,
    domainName,
    accountId,
    accountLabel,
    languagesText,
    timeLimit,
    memoryLimit,
    judgeConfig,
  }: ProgrammingRefInput): ProgrammingReference | null {
    const problemId = String(externalProblemId ?? '').trim();
    if (!problemId) return null;
    const inferredBaseUrl = String(platformBaseUrl ?? '').trim() || baseUrlFromProblemUrl(externalProblemUrl);
    const inferredSite = inferredBaseUrl
      ? hydroSiteOptions.value.find((site) => sameHydroBaseUrl(site.value, inferredBaseUrl))
      : null;
    const provider = String(judgeProvider ?? inferredSite?.judgeProvider ?? '').trim().toLowerCase() || undefined;
    const ref: ProgrammingReference = {
      judgeProvider: provider,
      externalProblemId: problemId,
      externalProblemUrl: String(externalProblemUrl ?? '').trim() || undefined,
      platformBaseUrl: inferredSite?.value || inferredBaseUrl || undefined,
      domainId: String(domainId ?? '').trim() || undefined,
      domainName: String(domainName ?? '').trim() || undefined,
      accountId: String(accountId ?? '').trim() || undefined,
      accountLabel: String(accountLabel ?? '').trim() || undefined,
      languages: parseHydroLanguages(languagesText || 'cc.cc17o2, py.py3'),
    };
    if (timeLimit) ref.timeLimit = Number(timeLimit);
    if (memoryLimit) ref.memoryLimit = Number(memoryLimit);
    if (judgeConfig) {
      ref.judgeConfig = {
        ...recordValue(judgeConfig),
        ...(provider ? { platformCode: provider } : {}),
      };
    }
    return ref;
  }

  async function pullSingleHydroProblem() {
    normalizeHydroProblemInput(singleForm.programmingRef);
    if (!canPullSingleHydroProblem.value) {
      ElMessage.warning('请先填写 Hydro 题号或链接');
      return;
    }

    const problemUrl = effectiveHydroProblemUrl(singleForm.programmingRef);
    singleHydroPulling.value = true;
    try {
      const pulled = await pullHydroProblem({
          problemId: singleForm.programmingRef.externalProblemId.trim(),
          problemUrl: problemUrl || undefined,
          platformBaseUrl: singleForm.programmingRef.platformBaseUrl.trim() || undefined,
          domainId: singleForm.programmingRef.domainId.trim() || undefined,
          domainName: singleForm.programmingRef.domainName.trim() || undefined,
          accountId: singleForm.programmingRef.accountId || undefined,
          judgeProvider: singleForm.programmingRef.judgeProvider || undefined,
        });
      applyPulledHydroProblem(singleForm, pulled);
      refreshPreview();
      scheduleSingleDuplicateCheck();
      ElMessage.success('Hydro 题目已拉取');
    } catch (error) {
      ElMessage.error(errorMessage(error, 'Hydro 题目拉取失败'));
    } finally {
      singleHydroPulling.value = false;
    }
  }

  function applyPulledHydroProblem(target: SingleQuestionForm, pulled: HydroPulledProblem) {
    const ref = pulled.programmingRef ?? pulled;
    target.type = 'programming';
    target.title = pulled.title || target.title;
    target.content = pulled.content || target.content;
    target.programmingRef.externalProblemId = ref.externalProblemId || pulled.externalProblemId || target.programmingRef.externalProblemId;
    target.programmingRef.externalProblemUrl = ref.externalProblemUrl || pulled.externalProblemUrl || target.programmingRef.externalProblemUrl;
    target.programmingRef.platformBaseUrl = ref.platformBaseUrl || ref.judgeConfig?.platformBaseUrl || target.programmingRef.platformBaseUrl;
    target.programmingRef.judgeProvider = ref.judgeProvider || ref.judgeConfig?.platformCode || target.programmingRef.judgeProvider || 'hydro';
    const pulledDomainId = ref.domainId || ref.judgeConfig?.domainId || target.programmingRef.domainId || 'system';
    target.programmingRef.domainId = pulledDomainId;
    target.programmingRef.domainName = ref.domainName || ref.judgeConfig?.domainName || pulledDomainId;
    target.programmingRef.accountId = ref.accountId || ref.judgeConfig?.accountId || target.programmingRef.accountId || '';
    target.programmingRef.accountLabel = ref.accountLabel || ref.judgeConfig?.accountLabel || target.programmingRef.accountLabel || '';
    target.programmingRef.languagesText = (ref.languages || pulled.languages || []).join(', ') || target.programmingRef.languagesText;
    target.programmingRef.timeLimit = ref.timeLimit ?? pulled.timeLimit ?? null;
    target.programmingRef.memoryLimit = ref.memoryLimit ?? pulled.memoryLimit ?? null;
    target.programmingRef.judgeConfig = ref.judgeConfig ?? null;
    resetSingleOptions();
  }

  function parseHydroLanguages(value: unknown) {
    return String(value || '')
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function openSingleHydroProblem() {
    if (!singleHydroProblemUrl.value) return;
    window.open(singleHydroProblemUrl.value, '_blank', 'noopener,noreferrer');
  }

  function effectiveHydroProblemUrl(ref: ProgrammingReference) {
    const explicit = String(ref?.externalProblemUrl || '').trim();
    if (!explicit) return '';
    const explicitProblemId = problemIdFromHydroUrl(explicit);
    const currentProblemId = cleanHydroProblemId(ref?.externalProblemId);
    if (explicitProblemId && currentProblemId && explicitProblemId !== currentProblemId) return '';
    return explicit;
  }

  function cleanHydroProblemId(value: unknown) {
    return String(value || '').trim().replace(/^#/, '');
  }

  function parseHydroProblemUrl(value: unknown) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
      const parsed = new URL(raw);
      const problemId = problemIdFromHydroUrl(raw);
      if (!problemId) return null;
      return {
        url: raw,
        problemId,
        baseUrl: `${parsed.protocol}//${parsed.host}`,
        domainId: domainIdFromHydroUrl(raw) || 'system',
      };
    } catch {
      return null;
    }
  }

  function problemIdFromHydroUrl(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/\/p\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
  }

  function domainIdFromHydroUrl(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/\/d\/([^/]+)\/p\//);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : 'system';
  }

  function normalizeBaseUrl(value: unknown) {
    const raw = String(value || 'https://oj.example.com').trim() || 'https://oj.example.com';
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
  }

  function shortHost(value: unknown) {
    try {
      return new URL(normalizeBaseUrl(value)).host;
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }

  function canonicalHost(value: unknown) {
    return shortHost(value).toLowerCase().replace(/^www\./, '');
  }

  function sameHydroBaseUrl(left: unknown, right: unknown) {
    const leftHost = canonicalHost(left);
    const rightHost = canonicalHost(right);
    return Boolean(leftHost && rightHost && leftHost === rightHost);
  }

  function baseUrlFromProblemUrl(url: unknown) {
    try {
      const parsed = new URL(String(url || '').trim());
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }

  function programmingRefBaseUrl(ref?: ProgrammingReference | null) {
    const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
    return raw ? normalizeBaseUrl(raw) : '';
  }

  function matchingHydroAccountsForRef(ref?: ProgrammingReference | null) {
    const targetBaseUrl = programmingRefBaseUrl(ref);
    if (!targetBaseUrl) return hydroAccounts.value;
    return hydroAccounts.value.filter((account) => sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl));
  }

  return {
    formatHydroDomainLabel,
    loadHydroAccounts,
    handleSingleHydroAccountChange,
    handleSingleHydroSiteChange,
    handleSingleHydroProblemInputChange,
    normalizeHydroProblemInput,
    applyHydroSiteToRef,
    syncSingleHydroAccountForSite,
    matchingHydroAccountForSite,
    buildSingleProgrammingRefPayload,
    normalizeProgrammingRef,
    buildProgrammingRefFromValues,
    pullSingleHydroProblem,
    applyPulledHydroProblem,
    parseHydroLanguages,
    openSingleHydroProblem,
    effectiveHydroProblemUrl,
    cleanHydroProblemId,
    parseHydroProblemUrl,
    problemIdFromHydroUrl,
    domainIdFromHydroUrl,
    normalizeBaseUrl,
    shortHost,
    canonicalHost,
    sameHydroBaseUrl,
    baseUrlFromProblemUrl,
    programmingRefBaseUrl,
    matchingHydroAccountsForRef,
  };
}
