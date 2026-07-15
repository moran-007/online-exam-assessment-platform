import { ElMessage } from 'element-plus';
import { getHydroSubmission, listMyHydroAccounts, submitHydroAttemptCode } from '../../hydro/api';
import type { HydroAccountView, HydroSubmissionResult } from '../../hydro/models';
import type {
  ExamQuestion,
  ExamQuestionEntry,
  ProgrammingReference,
  ProgrammingSubmissionFeedback,
  ProgrammingSubmissionResult,
} from '../models';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function useExamProgrammingSubmission(options: {
  state: State;
  languageOptionsFor: (question: ExamQuestion) => string[];
}) {
  const { state, languageOptionsFor } = options;

  function openHydroProblem(question: ExamQuestion) {
    const url = question.programmingRef?.externalProblemUrl;
    if (!url) {
      ElMessage.warning('该题尚未配置 Hydro 链接');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function loadHydroAccounts() {
    try {
      state.hydroAccounts.value = await listMyHydroAccounts();
    } catch {
      state.hydroAccounts.value = [];
    }
  }

  function defaultHydroAccountId(question: ExamQuestion) {
    const matched = matchedHydroAccountsFor(question);
    const boundAccountId = question?.programmingRef?.accountId;
    return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
  }

  function matchedHydroAccountsFor(question: ExamQuestion) {
    const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
    if (!targetBaseUrl) return [];
    return state.hydroAccounts.value.filter(
      (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
    );
  }

  function programmingRefBaseUrl(ref?: ProgrammingReference | null) {
    const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
    return raw ? normalizeBaseUrl(raw) : '';
  }

  function baseUrlFromProblemUrl(url?: string | null) {
    try {
      const parsed = new URL(String(url || '').trim());
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }

  function normalizeBaseUrl(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
  }

  function shortHost(value?: string | null) {
    try {
      return new URL(normalizeBaseUrl(value)).host;
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }

  function sameHydroBaseUrl(left?: string | null, right?: string | null) {
    const leftHost = canonicalHost(left);
    const rightHost = canonicalHost(right);
    return Boolean(leftHost && rightHost && leftHost === rightHost);
  }

  function canonicalHost(value?: string | null) {
    return shortHost(value).toLowerCase().replace(/^www\./, '');
  }

  function hydroAccountLabel(account: HydroAccountView) {
    return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
  }

  function hydroSourceLabel(ref?: ProgrammingReference | null) {
    const host = shortHost(programmingRefBaseUrl(ref));
    const domain = ref?.domainName || ref?.domainId || 'system';
    return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
  }

  async function submitCode(entry: ExamQuestionEntry) {
    const question = entry.question;
    const answer = state.answers[question.questionId];
    const accountId = state.selectedHydroAccountIds[question.questionId];
    if (!state.attemptId.value || !answer) return;
    if (!String(answer.code ?? '').trim()) {
      ElMessage.warning('请先填写代码');
      return;
    }
    if (!accountId) {
      ElMessage.warning('请选择当前题目来源站点下的提交账号');
      return;
    }

    state.codeSubmitLoading[question.questionId] = true;
    try {
      const result = await submitHydroAttemptCode(state.attemptId.value, question.questionId, {
        language: answer.language || languageOptionsFor(question)[0],
        code: answer.code,
        accountId,
      });
      state.codeSubmitFeedback[question.questionId] = buildSubmissionFeedback(result, 'success');
      ElMessage.success(result.message || '代码已提交');
    } catch (error: unknown) {
      state.codeSubmitFeedback[question.questionId] = {
        type: 'error', title: '代码提交失败', message: errorMessage(error, '代码提交失败'),
        status: '', language: answer.language, externalSubmissionId: '', score: null,
        maxScore: Number(question.score || 0), passedTestCaseCount: null,
        totalTestCaseCount: null, scoreRate: null, isCorrect: null, submissionId: '',
        problemUrl: '', recordUrl: '',
      };
      ElMessage.error(errorMessage(error, '代码提交失败'));
    } finally {
      state.codeSubmitLoading[question.questionId] = false;
    }
  }

  async function refreshSubmission(questionId: string) {
    const feedback = state.codeSubmitFeedback[questionId];
    if (!feedback?.submissionId) return;
    state.codeSubmitLoading[questionId] = true;
    try {
      const detail = await getHydroSubmission(feedback.submissionId);
      state.codeSubmitFeedback[questionId] = buildSubmissionFeedback(detail, detail.isCorrect === true ? 'success' : 'info');
      ElMessage.success('判题结果已刷新');
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '刷新失败'));
    } finally {
      state.codeSubmitLoading[questionId] = false;
    }
  }

  function buildSubmissionFeedback(
    result: ProgrammingSubmissionResult | HydroSubmissionResult,
    fallbackType: ProgrammingSubmissionFeedback['type'] = 'info',
  ): ProgrammingSubmissionFeedback {
    const status = result.status || '';
    const final = !['pending', 'judging'].includes(status);
    const detail = resultRecord(result.result);
    const passedTestCaseCount = nullableNumber(result.passedTestCaseCount ?? detail.passedTestCaseCount);
    const totalTestCaseCount = nullableNumber(result.totalTestCaseCount ?? detail.totalTestCaseCount);
    const score = nullableNumber(result.score);
    const maxScore = nullableNumber(result.maxScore) ?? 0;
    const scoreRate = nullableNumber(result.scoreRate ?? detail.scoreRate);
    const isFullScore = isFullProgrammingScore({
      isCorrect: result.isCorrect, score, maxScore, passedTestCaseCount,
      totalTestCaseCount, scoreRate, status,
    });
    return {
      type: isFullScore ? 'success' : final ? 'error' : fallbackType,
      title: result.mode === 'manual' ? '本地提交已记录' : isFullScore
        ? '全部测试点通过' : final ? '部分测试点未通过' : '等待 Hydro 评测',
      message: result.message || '', status, language: result.language || '',
      externalSubmissionId: result.externalSubmissionId || '', score, maxScore,
      passedTestCaseCount, totalTestCaseCount, scoreRate, isCorrect: final ? isFullScore : null,
      submissionId: result.submissionId || '', problemUrl: result.problemUrl || '',
      recordUrl: result.recordUrl || '',
    };
  }

  function isFullProgrammingScore(result: {
    passedTestCaseCount?: number | null; totalTestCaseCount?: number | null;
    scoreRate?: number | null; score?: number | null; maxScore?: number | null;
    isCorrect?: boolean | null; status?: string | null;
  }) {
    const passed = Number(result.passedTestCaseCount);
    const total = Number(result.totalTestCaseCount);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) return passed === total;
    const rate = Number(result.scoreRate);
    if (Number.isFinite(rate)) return rate >= 1;
    const score = Number(result.score);
    const maxScore = Number(result.maxScore);
    if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) return score >= maxScore;
    if (result.isCorrect === true) return true;
    if (result.isCorrect === false) return false;
    return result.status === 'accepted';
  }

  return {
    openHydroProblem, loadHydroAccounts, defaultHydroAccountId, matchedHydroAccountsFor,
    programmingRefBaseUrl, baseUrlFromProblemUrl, normalizeBaseUrl, shortHost,
    sameHydroBaseUrl, canonicalHost, hydroAccountLabel, hydroSourceLabel, submitCode,
    refreshSubmission, buildSubmissionFeedback, isFullProgrammingScore,
  };
}
