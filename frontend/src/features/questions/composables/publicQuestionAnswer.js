import { languageOptionsFor } from '../../../question-engine/answer-utils';

export function emptyQuestionAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || 'cc.cc17o2',
  };
}

export function payloadForAnswer(answerValue) {
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

export function materialChildren(question) {
  return Array.isArray(question?.children) ? question.children : [];
}

export function materialChildQuestion(child) {
  const question = child?.question || child?.snapshot || child || {};
  return {
    ...question,
    id: question.id || question.questionId || child?.questionId,
    questionId: question.questionId || question.id || child?.questionId,
    defaultScore: materialChildScore(child),
  };
}

export function materialChildId(child) {
  const question = materialChildQuestion(child);
  return question.questionId || question.id || child?.questionId;
}

export function materialChildScore(child) {
  const explicit = Number(child?.score);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const fallback = Number((child?.question || child?.snapshot || child || {}).defaultScore);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

export function hasAnswer(answerValue) {
  return Boolean(
    answerValue?.selectedOptionIds?.filter(Boolean).length
    || answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())
    || String(answerValue?.text ?? '').trim()
    || String(answerValue?.code ?? '').trim(),
  );
}

export function scaleMaterialChildResult(childResult, targetScore) {
  const sourceTotal = Number(childResult?.totalScore);
  const score = Number(childResult?.score);
  if (!Number.isFinite(sourceTotal) || sourceTotal <= 0 || !Number.isFinite(score)) {
    return { ...childResult, score: 0, totalScore: targetScore };
  }
  if (Math.abs(sourceTotal - targetScore) < 0.0001) return childResult;
  return {
    ...childResult,
    score: roundScore((score / sourceTotal) * targetScore),
    totalScore: targetScore,
  };
}

export function roundScore(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0;
}

export function programmingFeedbackType(result) {
  if (!isProgrammingFinal(result)) return 'info';
  return isFullProgrammingScore(result) ? 'success' : 'error';
}

export function programmingFeedbackTitle(result) {
  if (!isProgrammingFinal(result)) return '等待 Hydro 评测';
  return isFullProgrammingScore(result) ? '全部测试点通过' : '部分测试点未通过';
}

function isProgrammingFinal(result) {
  return Boolean(result) && !['pending', 'judging'].includes(result.status);
}

function isFullProgrammingScore(result) {
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

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(question?.content));
}

function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
  return Array.from({ length: count }, (_, index) => {
    const blankIndex = index + 1;
    const current = source.find((blank) => Number(blank?.index) === blankIndex);
    return { index: blankIndex, value: current?.value ?? '' };
  });
}

function countBlankMarkers(content) {
  const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
  return matches?.length || 1;
}
