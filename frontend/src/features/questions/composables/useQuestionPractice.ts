import type { Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { checkQuestionAnswer, getQuestion } from '../api';
import { submitHydroPracticeCode } from '../../hydro/api';
import type { HydroSubmissionResult } from '../../hydro/models';
import type {
  AnswerCheckResult,
  PracticeAnswer,
  QuestionChild,
  QuestionRecord,
} from '../models';

type PracticeState = {
  practiceVisible: Ref<boolean>;
  practiceDetail: Ref<QuestionRecord | null>;
  practiceResult: Ref<AnswerCheckResult | null>;
  practiceProgrammingResult: Ref<HydroSubmissionResult | null>;
  practiceProgrammingSubmitLoading: Ref<boolean>;
  practiceHydroAccountId: Ref<string>;
  practiceAnswer: PracticeAnswer;
  practiceChildAnswers: Record<string, PracticeAnswer>;
  practiceChildResults: Record<string, AnswerCheckResult>;
  editMode: Ref<boolean>;
  editQuestion: (row: Pick<QuestionRecord, 'id'>) => Promise<void>;
  defaultHydroAccountId: (question: QuestionRecord) => string;
  languageOptionsFor: (question: QuestionRecord | null) => string[];
};

export function initialPracticeAnswer(): PracticeAnswer {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
    code: '',
    language: 'cc.cc17o2',
  };
}

export function useQuestionPractice(state: PracticeState) {
  const {
    defaultHydroAccountId,
    editMode,
    editQuestion,
    languageOptionsFor,
    practiceAnswer,
    practiceChildAnswers,
    practiceChildResults,
    practiceDetail,
    practiceHydroAccountId,
    practiceProgrammingResult,
    practiceProgrammingSubmitLoading,
    practiceResult,
    practiceVisible,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function asQuestionRecord(value: unknown): QuestionRecord {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
      throw new Error('题目数据无效');
    }
    return value as QuestionRecord;
  }

  async function openPracticeQuestion(value: unknown) {
    const row = asQuestionRecord(value);
    try {
      practiceDetail.value = await getQuestion(row.id);
      clearPracticeAnswer();
      practiceHydroAccountId.value =
        practiceDetail.value?.type === 'programming' ? defaultHydroAccountId(practiceDetail.value) : '';
      practiceVisible.value = true;
    } catch (error) {
      ElMessage.error(errorMessage(error));
    }
  }

  function editQuestionFromPractice() {
    const detail = practiceDetail.value;
    practiceVisible.value = false;
    if (detail) {
      editMode.value = true;
      editQuestion(detail);
    }
  }

  async function checkPracticeAnswer() {
    if (!practiceDetail.value) return;
    if (practiceDetail.value.type === 'programming') {
      await submitPracticeProgrammingAnswer();
      return;
    }
    if (practiceDetail.value.type === 'material') {
      await checkMaterialPracticeAnswer();
      return;
    }
    try {
      practiceResult.value = await checkQuestionAnswer(practiceDetail.value.id, payloadForPracticeAnswer());
    } catch (error) {
      ElMessage.error(errorMessage(error));
    }
  }

  async function submitPracticeProgrammingAnswer() {
    if (!practiceDetail.value) return;
    if (!String(practiceAnswer.code ?? '').trim()) {
      ElMessage.warning('请先填写代码');
      return;
    }
    if (!practiceHydroAccountId.value) {
      ElMessage.warning('请选择当前题目来源站点下的提交账号');
      return;
    }
    practiceProgrammingSubmitLoading.value = true;
    try {
      const response = await submitHydroPracticeCode(practiceDetail.value.id, {
          language: practiceAnswer.language || languageOptionsFor(practiceDetail.value)[0],
          code: practiceAnswer.code,
          accountId: practiceHydroAccountId.value,
      });
      practiceProgrammingResult.value = response;
      ElMessage.success(response.message || '代码已提交到 Hydro');
    } catch (error) {
      ElMessage.error(errorMessage(error, 'Hydro 提交失败'));
    } finally {
      practiceProgrammingSubmitLoading.value = false;
    }
  }

  function emptyPracticeAnswer(question: QuestionRecord | null = null): PracticeAnswer {
    return {
      selectedOptionIds: [],
      blanks: blankAnswerList(question),
      text: '',
      code: '',
      language: languageOptionsFor(question)[0] || 'cc.cc17o2',
    };
  }

  function clearPracticeAnswer() {
    Object.assign(practiceAnswer, emptyPracticeAnswer(practiceDetail.value));
    resetPracticeChildState();
    if (practiceDetail.value?.type === 'material') {
      for (const child of materialChildren(practiceDetail.value)) {
        practiceChildAnswers[materialChildId(child)] = emptyPracticeAnswer(materialChildQuestion(child));
      }
    }
    practiceResult.value = null;
    practiceProgrammingResult.value = null;
  }

  function updatePracticeAnswer(value: Partial<PracticeAnswer>) {
    Object.assign(practiceAnswer, {
      selectedOptionIds: Array.isArray(value?.selectedOptionIds) ? value.selectedOptionIds : [],
      blanks: Array.isArray(value?.blanks) ? value.blanks : blankAnswerList(practiceDetail.value),
      text: value?.text ?? '',
      code: value?.code ?? practiceAnswer.code ?? '',
      language: value?.language ?? practiceAnswer.language ?? languageOptionsFor(practiceDetail.value)[0] ?? 'cc.cc17o2',
    });
  }

  function payloadForPracticeAnswer() {
    return payloadForAnswer(practiceAnswer);
  }

  function payloadForAnswer(answerValue: Partial<PracticeAnswer>) {
    if (answerValue?.selectedOptionIds?.filter(Boolean).length) {
      return { selectedOptionIds: answerValue.selectedOptionIds.filter(Boolean) };
    }
    if (answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())) {
      return { blanks: answerValue.blanks };
    }
    if (String(answerValue?.text ?? '').trim()) {
      return { text: answerValue.text };
    }
    if (String(answerValue?.code ?? '').trim()) {
      return {
        text: answerValue.code,
        code: answerValue.code,
        language: answerValue.language || 'cc.cc17o2',
      };
    }
    return {};
  }

  function resetPracticeChildState() {
    Object.keys(practiceChildAnswers).forEach((key) => delete practiceChildAnswers[key]);
    Object.keys(practiceChildResults).forEach((key) => delete practiceChildResults[key]);
  }

  function updatePracticeChildAnswers(value: Record<string, PracticeAnswer>) {
    Object.keys(practiceChildAnswers).forEach((key) => delete practiceChildAnswers[key]);
    Object.entries(value || {}).forEach(([key, childAnswer]) => {
      practiceChildAnswers[key] = childAnswer;
    });
  }

  function materialChildren(question: QuestionRecord | null): QuestionChild[] {
    return Array.isArray(question?.children) ? question.children : [];
  }

  function materialChildQuestion(child: QuestionChild): QuestionRecord {
    const question = child.question || child.snapshot;
    const id = question?.id || question?.questionId || child.questionId || child.localId || '';
    return {
      ...child,
      ...question,
      id,
      questionId: question?.questionId || question?.id || child.questionId || id,
      type: question?.type || child.type || 'short_answer',
      title: question?.title || child.title || '',
      content: question?.content || child.content || '',
      difficulty: question?.difficulty || child.difficulty || 1,
      defaultScore: materialChildScore(child),
    };
  }

  function materialChildId(child: QuestionChild): string {
    const question = materialChildQuestion(child);
    return question.questionId || question.id || child.questionId || '';
  }

  function materialChildScore(child: QuestionChild): number {
    const explicit = Number(child?.score);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const fallback = Number(child.question?.defaultScore ?? child.snapshot?.defaultScore ?? child.score);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }

  function hasPracticeAnswer(answerValue: Partial<PracticeAnswer>) {
    return Boolean(
      answerValue?.selectedOptionIds?.filter(Boolean).length
      || answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())
      || String(answerValue?.text ?? '').trim()
      || String(answerValue?.code ?? '').trim(),
    );
  }

  async function checkMaterialPracticeAnswer() {
    const children = materialChildren(practiceDetail.value);
    if (!children.length) {
      ElMessage.warning('该材料/组合题尚未配置子题');
      return;
    }

    const missingIndex = children.findIndex((child) => !hasPracticeAnswer(practiceChildAnswers[materialChildId(child)]));
    if (missingIndex >= 0) {
      ElMessage.warning(`请先完成第 ${missingIndex + 1} 道子题`);
      return;
    }

    try {
      const results = [];
      Object.keys(practiceChildResults).forEach((key) => delete practiceChildResults[key]);
      for (const child of children) {
        const childId = materialChildId(child);
        const response = await checkQuestionAnswer(childId, payloadForAnswer(practiceChildAnswers[childId] || {}));
        const scaled = scaleMaterialChildResult(response, materialChildScore(child));
        practiceChildResults[childId] = scaled;
        results.push(scaled);
      }

      const score = roundScore(results.reduce((sum, item) => sum + Number(item.score || 0), 0));
      const totalScore = roundScore(children.reduce((sum, child) => sum + materialChildScore(child), 0));
      const hasWrong = results.some((item) => item.isCorrect === false);
      const hasPending = results.some((item) => item.isCorrect === null || item.status === 'manual_needed');
      practiceResult.value = {
        isCorrect: hasPending ? null : !hasWrong,
        score,
        totalScore,
        status: hasPending ? 'manual_needed' : 'auto_graded',
        message: hasPending ? '材料/组合题已提交，部分子题待批改' : hasWrong ? '材料/组合题存在错误' : '材料/组合题回答正确',
        details: results.map((item, index) => ({
          childIndex: index + 1,
          questionId: materialChildId(children[index]),
          score: item.score,
          totalScore: item.totalScore,
          isCorrect: item.isCorrect,
          status: item.status,
        })),
      };
    } catch (error) {
      ElMessage.error(errorMessage(error));
    }
  }

  function scaleMaterialChildResult(result: AnswerCheckResult, targetScore: number): AnswerCheckResult {
    const sourceTotal = Number(result?.totalScore);
    const score = Number(result?.score);
    if (!Number.isFinite(sourceTotal) || sourceTotal <= 0 || !Number.isFinite(score)) {
      return { ...result, score: 0, totalScore: targetScore };
    }
    if (Math.abs(sourceTotal - targetScore) < 0.0001) return result;
    return {
      ...result,
      score: roundScore((score / sourceTotal) * targetScore),
      totalScore: targetScore,
    };
  }

  function roundScore(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0;
  }

  function blankCountFor(question: QuestionRecord | null) {
    const explicit = Number(question?.blankCount);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    const answerBlanks = question?.answer?.blanks;
    if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
    return Math.max(1, countBlankMarkers(question?.content));
  }

  function blankAnswerList(question: QuestionRecord | null, existing: PracticeAnswer['blanks'] = []): PracticeAnswer['blanks'] {
    const source = Array.isArray(existing) ? existing : [];
    const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
    return Array.from({ length: count }, (_, index) => {
      const blankIndex = index + 1;
      const current = source.find((blank) => Number(blank?.index) === blankIndex);
      return { index: blankIndex, value: current?.value ?? '' };
    });
  }

  function countBlankMarkers(content?: string) {
    const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
    return matches?.length || 1;
  }

  return {
    openPracticeQuestion,
    editQuestionFromPractice,
    checkPracticeAnswer,
    submitPracticeProgrammingAnswer,
    emptyPracticeAnswer,
    clearPracticeAnswer,
    updatePracticeAnswer,
    payloadForPracticeAnswer,
    payloadForAnswer,
    resetPracticeChildState,
    updatePracticeChildAnswers,
    materialChildren,
    materialChildQuestion,
    materialChildId,
    materialChildScore,
    hasPracticeAnswer,
    checkMaterialPracticeAnswer,
    scaleMaterialChildResult,
    roundScore,
    blankCountFor,
    blankAnswerList,
    countBlankMarkers,
  };
}
