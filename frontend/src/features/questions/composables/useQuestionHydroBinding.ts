import type { ComputedRef, Ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  listHydroPlatforms,
  listMyHydroAccounts,
  pullHydroProblem as fetchHydroProblem,
} from '../../hydro/api';
import type {
  HydroAccountView,
  HydroPlatform,
  HydroPulledProblem,
  HydroSubmissionResult,
} from '../../hydro/models';
import type {
  HydroSiteOption,
  ProgrammingReference,
  QuestionForm,
  QuestionRecord,
} from '../models';

type HydroState = {
  canPullHydroProblem: ComputedRef<boolean>;
  form: QuestionForm;
  hydroAccounts: Ref<HydroAccountView[]>;
  hydroPlatforms: Ref<HydroPlatform[]>;
  hydroPulling: Ref<boolean>;
  hydroProblemUrl: ComputedRef<string>;
  hydroSiteOptions: ComputedRef<HydroSiteOption[]>;
  selectedHydroAccount: ComputedRef<HydroAccountView | null>;
  resetOptions: () => void;
};

export function useQuestionHydroBinding(state: HydroState) {
  const {
    canPullHydroProblem,
    form,
    hydroAccounts,
    hydroPlatforms,
    hydroProblemUrl,
    hydroPulling,
    hydroSiteOptions,
    resetOptions,
    selectedHydroAccount,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function formatHydroDomainLabel(ref: ProgrammingReference) {
    const domainId = String(ref?.domainId || '').trim();
    const domainName = String(ref?.domainName || '').trim();
    if (domainId && domainName && domainName !== domainId && domainName !== 'system') {
      return `${domainId} / ${domainName}`;
    }
    return domainId || domainName || 'system';
  }

  function languageOptionsFor(question: QuestionRecord | null) {
    const languages = question?.programmingRef?.languages || [];
    return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
  }

  function languageLabel(language: string) {
    const labels: Record<string, string> = {
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
      cpp17: 'C++17',
      python3: 'Python 3',
      java: 'Java',
      c: 'C',
      cc: 'C++',
      pas: 'Pascal',
    };
    return labels[language] ?? language;
  }

  function programmingFeedbackType(result: HydroSubmissionResult | null) {
    if (!isProgrammingFinal(result)) return 'info';
    return isFullProgrammingScore(result) ? 'success' : 'error';
  }

  function programmingFeedbackTitle(result: HydroSubmissionResult | null) {
    if (!isProgrammingFinal(result)) return '等待 Hydro 评测';
    return isFullProgrammingScore(result) ? '全部测试点通过' : '部分测试点未通过';
  }

  function isProgrammingFinal(result: HydroSubmissionResult | null) {
    return result !== null && !['pending', 'judging'].includes(result.status ?? '');
  }

  function isFullProgrammingScore(result: HydroSubmissionResult | null) {
    const passed = Number(result?.passedTestCaseCount);
    const total = Number(result?.totalTestCaseCount);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) return passed === total;
    const rate = Number(result?.scoreRate);
    if (Number.isFinite(rate)) return rate >= 1;
    const score = Number(result?.score);
    const maxScore = Number(result?.maxScore);
    if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) return score >= maxScore;
    if (result?.isCorrect === true) return true;
    if (result?.isCorrect === false) return false;
    return result?.status === 'accepted';
  }

  async function loadHydroAccounts() {
    try {
      const data = await listMyHydroAccounts();
      hydroAccounts.value = data;
      syncHydroAccountForSite();
    } catch {
      hydroAccounts.value = [];
    }
  }

  async function loadHydroPlatforms() {
    try {
      hydroPlatforms.value = await listHydroPlatforms();
    } catch {
      hydroPlatforms.value = [];
    }
  }

  function handleHydroAccountChange(accountId: string) {
    const account = hydroAccounts.value.find((item) => item.id === accountId);
    if (!account) {
      form.programmingRef.accountLabel = '';
      return;
    }
    form.programmingRef.platformBaseUrl = account.platformBaseUrl || form.programmingRef.platformBaseUrl;
    form.programmingRef.judgeProvider = account.platformCode || form.programmingRef.judgeProvider || 'hydro';
    form.programmingRef.accountLabel = `${account.loginUsername || account.hydroUsername}@${shortHost(account.platformBaseUrl)}`;
  }

  function handleHydroSiteChange(value: string) {
    applyHydroSiteToRef(form.programmingRef, value);
    if (form.programmingRef.externalProblemUrl && value && !sameHydroBaseUrl(form.programmingRef.externalProblemUrl, value)) {
      form.programmingRef.externalProblemUrl = '';
    }
    syncHydroAccountForSite();
  }

  function handleHydroProblemInputChange() {
    normalizeHydroProblemInput(form.programmingRef);
    syncHydroAccountForSite();
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

  function syncHydroAccountForSite() {
    const account = selectedHydroAccount.value;
    if (account && sameHydroBaseUrl(account.platformBaseUrl, form.programmingRef.platformBaseUrl)) {
      handleHydroAccountChange(account.id);
      return;
    }
    const nextAccount = matchingHydroAccountForSite(form.programmingRef.platformBaseUrl || '');
    form.programmingRef.accountId = nextAccount?.id || '';
    form.programmingRef.accountLabel = nextAccount
      ? `${nextAccount.loginUsername || nextAccount.hydroUsername}@${shortHost(nextAccount.platformBaseUrl)}`
      : '';
    if (nextAccount?.platformCode) {
      form.programmingRef.judgeProvider = nextAccount.platformCode;
    }
  }

  function matchingHydroAccountForSite(baseUrl: string) {
    return hydroAccounts.value.find((account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
      || hydroAccounts.value.find((account) => sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
      || null;
  }

  function buildProgrammingRefPayload(): ProgrammingReference | null {
    normalizeHydroProblemInput(form.programmingRef);
    const externalProblemId = form.programmingRef.externalProblemId.trim();
    if (!externalProblemId) return null;
    const payload: ProgrammingReference = {
      judgeProvider: form.programmingRef.judgeProvider || undefined,
      externalProblemId,
      externalProblemUrl: effectiveHydroProblemUrl(form.programmingRef) || undefined,
      platformBaseUrl: form.programmingRef.platformBaseUrl?.trim() || undefined,
      domainId: form.programmingRef.domainId?.trim() || undefined,
      domainName: form.programmingRef.domainName?.trim() || undefined,
      accountId: form.programmingRef.accountId || undefined,
      accountLabel: form.programmingRef.accountLabel?.trim() || undefined,
      languages: parseHydroLanguages(form.programmingRef.languagesText),
    };
    if (form.programmingRef.timeLimit) payload.timeLimit = Number(form.programmingRef.timeLimit);
    if (form.programmingRef.memoryLimit) payload.memoryLimit = Number(form.programmingRef.memoryLimit);
    if (form.programmingRef.judgeConfig) {
      payload.judgeConfig = {
        ...form.programmingRef.judgeConfig,
        ...(form.programmingRef.judgeProvider ? { platformCode: form.programmingRef.judgeProvider } : {}),
      };
    }
    return payload;
  }

  async function pullHydroProblem() {
    normalizeHydroProblemInput(form.programmingRef);
    if (!canPullHydroProblem.value) {
      ElMessage.warning('请先填写 Hydro 题号或链接');
      return;
    }

    const problemUrl = effectiveHydroProblemUrl(form.programmingRef);
    hydroPulling.value = true;
    try {
      const pulled = await fetchHydroProblem({
          problemId: form.programmingRef.externalProblemId.trim(),
          problemUrl: problemUrl || undefined,
          platformBaseUrl: form.programmingRef.platformBaseUrl?.trim() || undefined,
          domainId: form.programmingRef.domainId?.trim() || undefined,
          domainName: form.programmingRef.domainName?.trim() || undefined,
          accountId: form.programmingRef.accountId || undefined,
          judgeProvider: form.programmingRef.judgeProvider || undefined,
        });
      applyPulledHydroProblem(form, pulled);
      ElMessage.success('Hydro 题目已拉取');
    } catch (error) {
      ElMessage.error(errorMessage(error, 'Hydro 题目拉取失败'));
    } finally {
      hydroPulling.value = false;
    }
  }

  function applyPulledHydroProblem(target: QuestionForm, pulled: HydroPulledProblem) {
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
    resetOptions();
  }

  function openHydroProblemUrl() {
    if (!hydroProblemUrl.value) return;
    window.open(hydroProblemUrl.value, '_blank', 'noopener,noreferrer');
  }

  function effectiveHydroProblemUrl(ref: ProgrammingReference) {
    const explicit = String(ref?.externalProblemUrl || '').trim();
    if (!explicit) return '';
    const explicitProblemId = problemIdFromHydroUrl(explicit);
    const currentProblemId = cleanHydroProblemId(ref?.externalProblemId);
    if (explicitProblemId && currentProblemId && explicitProblemId !== currentProblemId) return '';
    return explicit;
  }

  function cleanHydroProblemId(value: string) {
    return String(value || '').trim().replace(/^#/, '');
  }

  function parseHydroProblemUrl(value: string) {
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

  function problemIdFromHydroUrl(value?: string) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/\/p\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
  }

  function domainIdFromHydroUrl(value?: string) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/\/d\/([^/]+)\/p\//);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : 'system';
  }

  function normalizeBaseUrl(value?: string) {
    const raw = String(value || 'https://oj.example.com').trim() || 'https://oj.example.com';
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
  }

  function shortHost(value?: string) {
    try {
      return new URL(normalizeBaseUrl(value)).host;
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }

  function baseUrlFromProblemUrl(url?: string) {
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

  function matchedHydroAccountsFor(question: QuestionRecord | null) {
    const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
    if (!targetBaseUrl) return [];
    return hydroAccounts.value.filter(
      (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
    );
  }

  function defaultHydroAccountId(question: QuestionRecord) {
    const matched = matchedHydroAccountsFor(question);
    const boundAccountId = question?.programmingRef?.accountId;
    return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
  }

  function hydroPracticeAccountLabel(account: HydroAccountView) {
    return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
  }

  function sameHydroBaseUrl(left?: string, right?: string) {
    const leftHost = canonicalHost(left);
    const rightHost = canonicalHost(right);
    return Boolean(leftHost && rightHost && leftHost === rightHost);
  }

  function canonicalHost(value?: string) {
    return shortHost(value).toLowerCase().replace(/^www\./, '');
  }

  function hydroSourceLabel(ref?: ProgrammingReference | null) {
    const host = shortHost(programmingRefBaseUrl(ref));
    const domain = ref?.domainName || ref?.domainId || 'system';
    return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
  }

  function parseHydroLanguages(value?: string) {
    return String(value || '')
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function openHydroProblem(question: QuestionRecord) {
    const url = question?.programmingRef?.externalProblemUrl;
    if (!url) {
      ElMessage.warning('该题尚未配置 Hydro 链接');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return {
    formatHydroDomainLabel,
    languageOptionsFor,
    languageLabel,
    programmingFeedbackType,
    programmingFeedbackTitle,
    isProgrammingFinal,
    isFullProgrammingScore,
    loadHydroAccounts,
    loadHydroPlatforms,
    handleHydroAccountChange,
    handleHydroSiteChange,
    handleHydroProblemInputChange,
    normalizeHydroProblemInput,
    applyHydroSiteToRef,
    syncHydroAccountForSite,
    matchingHydroAccountForSite,
    buildProgrammingRefPayload,
    pullHydroProblem,
    applyPulledHydroProblem,
    openHydroProblemUrl,
    effectiveHydroProblemUrl,
    cleanHydroProblemId,
    parseHydroProblemUrl,
    problemIdFromHydroUrl,
    domainIdFromHydroUrl,
    normalizeBaseUrl,
    shortHost,
    baseUrlFromProblemUrl,
    programmingRefBaseUrl,
    matchingHydroAccountsForRef,
    matchedHydroAccountsFor,
    defaultHydroAccountId,
    hydroPracticeAccountLabel,
    sameHydroBaseUrl,
    canonicalHost,
    hydroSourceLabel,
    parseHydroLanguages,
    openHydroProblem,
  };
}
