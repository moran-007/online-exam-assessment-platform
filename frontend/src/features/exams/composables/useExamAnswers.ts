import type { ComputedRef } from 'vue';
import type { HydroSubmissionResult } from '../../hydro/models';
import type {
  AnswerBlank,
  ExamAnswerDraft,
  ExamQuestion,
  ExamQuestionEntry,
  ProgrammingSubmissionFeedback,
  ProgrammingSubmissionResult,
  SavedExamAnswer,
} from '../models';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;
type SubmissionResult = ProgrammingSubmissionResult | HydroSubmissionResult;

export function useExamAnswers(options: {
  state: State;
  flatQuestions: ComputedRef<ExamQuestionEntry[]>;
  buildSubmissionFeedback: (
    result: SubmissionResult,
    fallbackType?: ProgrammingSubmissionFeedback['type'],
  ) => ProgrammingSubmissionFeedback;
  defaultHydroAccountId: (question: ExamQuestion) => string;
}) {
  const { state, flatQuestions, buildSubmissionFeedback, defaultHydroAccountId } = options;
  const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);

  function emptyAnswer(): ExamAnswerDraft {
    return {
      selectedOptionIds: [],
      blanks: [{ index: 1, value: '' }],
      text: '',
      code: '',
      language: 'cc.cc17o2',
    };
  }

  function resetAnswers() {
    Object.keys(state.answers).forEach((key) => delete state.answers[key]);
    Object.keys(state.selectedHydroAccountIds).forEach((key) => delete state.selectedHydroAccountIds[key]);
    for (const entry of flatQuestions.value) {
      state.answers[entry.question.questionId] = {
        ...emptyAnswer(),
        blanks: blankAnswerList(entry.question),
        language: languageOptionsFor(entry.question)[0] || 'cc.cc17o2',
      };
      if (entry.question.type === 'programming') {
        state.selectedHydroAccountIds[entry.question.questionId] = defaultHydroAccountId(entry.question);
      }
    }
  }

  function applySavedAnswers(savedAnswers: SavedExamAnswer[]) {
    for (const saved of savedAnswers) {
      if (!state.answers[saved.questionId]) continue;
      const answer = saved.answer ?? {};
      state.answers[saved.questionId].selectedOptionIds = Array.isArray(answer.selectedOptionIds)
        ? answer.selectedOptionIds.filter(Boolean)
        : [];
      const question = flatQuestions.value.find((entry) => entry.question.questionId === saved.questionId)?.question;
      state.answers[saved.questionId].blanks = blankAnswerList(question, answer.blanks);
      state.answers[saved.questionId].text = typeof answer.text === 'string' ? answer.text : '';
      state.answers[saved.questionId].code = typeof answer.code === 'string'
        ? answer.code
        : typeof answer.text === 'string' ? answer.text : '';
      state.answers[saved.questionId].language = typeof answer.language === 'string'
        ? answer.language
        : question ? languageOptionsFor(question)[0] || 'cc.cc17o2' : 'cc.cc17o2';
      if (['judge_pending', 'judge_done'].includes(saved.status) || saved.autoResult?.latestSubmissionId) {
        state.codeSubmitFeedback[saved.questionId] = buildSubmissionFeedback({
          submissionId: saved.autoResult?.latestSubmissionId || answer.hydro?.submissionId || '',
          externalSubmissionId: saved.autoResult?.externalSubmissionId || answer.hydro?.externalSubmissionId || '',
          status: saved.autoResult?.status || (saved.status === 'judge_done' ? 'accepted' : 'pending'),
          isCorrect: saved.isCorrect,
          score: saved.score,
          maxScore: question?.score ?? saved.autoResult?.maxScore ?? 0,
          passedTestCaseCount: saved.autoResult?.passedTestCaseCount,
          totalTestCaseCount: saved.autoResult?.totalTestCaseCount,
          scoreRate: saved.autoResult?.scoreRate,
          language: state.answers[saved.questionId].language,
          mode: answer.hydro?.mode || saved.autoResult?.mode || 'direct',
          problemUrl: saved.autoResult?.problemUrl || answer.hydro?.problemUrl || '',
          recordUrl: saved.autoResult?.recordUrl || saved.autoResult?.result?.recordUrl || '',
          message: saved.autoResult?.message || (saved.status === 'judge_done' ? '判题结果已同步' : '等待 Hydro 判题结果'),
        }, saved.isCorrect === true ? 'success' : 'info');
      }
    }
  }

  function isAnswered(questionId: string) {
    const answer = state.answers[questionId];
    if (!answer) return false;
    return Boolean(
      answer.selectedOptionIds?.filter(Boolean).length
      || answer.blanks?.some((blank) => String(blank.value ?? '').trim())
      || String(answer.code ?? '').trim()
      || String(answer.text ?? '').trim(),
    );
  }

  function payloadFor(questionId: string) {
    const answer = state.answers[questionId];
    if (!answer) return {};
    if (answer.selectedOptionIds?.filter(Boolean).length) {
      return { selectedOptionIds: answer.selectedOptionIds.filter(Boolean) };
    }
    if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) return { blanks: answer.blanks };
    if (String(answer.code ?? '').trim()) {
      return { text: answer.code, code: answer.code, language: answer.language || 'cc.cc17o2' };
    }
    if (String(answer.text ?? '').trim()) return { text: answer.text };
    return {};
  }

  function languageOptionsFor(question: ExamQuestion) {
    const languages = question.programmingRef?.languages || [];
    return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
  }

  function isSplitQuestion(type: string) {
    return !objectiveQuestionTypes.has(type);
  }

  function blankCountFor(question?: ExamQuestion | null) {
    const explicit = Number(question?.blankCount);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    const answerBlanks = question?.answer?.blanks;
    if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
    return Math.max(1, countBlankMarkers(question?.content));
  }

  function blankAnswerList(question?: ExamQuestion | null, existing: AnswerBlank[] = []): AnswerBlank[] {
    const source = Array.isArray(existing) ? existing : [];
    const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
    return Array.from({ length: count }, (_, index) => {
      const blankIndex = index + 1;
      const current = source.find((blank) => Number(blank?.index) === blankIndex);
      return { index: blankIndex, value: current?.value ?? '' };
    });
  }

  function countBlankMarkers(content?: string | null) {
    return String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g)?.length || 1;
  }

  function typeLabel(value: string) {
    const map: Record<string, string> = {
      single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题',
      fill_blank: '填空题', short_answer: '简答题', programming: '编程题',
      material: '材料/组合题', file_upload: '文件上传题', scratch_project: 'Scratch 项目题',
      arduino_project: 'Arduino 项目题',
    };
    return map[value] ?? value;
  }

  function questionMetaLabel(entry: ExamQuestionEntry) {
    const questionType = typeLabel(entry.question.type);
    const sectionTitle = String(entry.sectionTitle || '').trim();
    if (!sectionTitle || sectionTitle === questionType || ['客观题', '主观题'].includes(sectionTitle)) return questionType;
    return `${questionType} · ${sectionTitle}`;
  }

  function languageLabel(language: string) {
    const labels: Record<string, string> = {
      'cc.cc17o2': 'C++17(O2)', 'cc.cc17': 'C++17', 'cc.cc14o2': 'C++14(O2)',
      'cc.cc14': 'C++14', 'cc.cc11o2': 'C++11(O2)', 'cc.cc11': 'C++11',
      'py.py3': 'Python 3', 'py.py2': 'Python 2', 'cc.cc20o2': 'C++20(O2)',
      'cc.cc20': 'C++20', cpp17: 'C++17', python3: 'Python 3', java: 'Java',
      c: 'C', cc: 'C++', pas: 'Pascal',
    };
    return labels[language] ?? language;
  }

  return {
    objectiveQuestionTypes, emptyAnswer, resetAnswers, applySavedAnswers, isAnswered,
    payloadFor, languageOptionsFor, isSplitQuestion, blankCountFor, blankAnswerList,
    countBlankMarkers, typeLabel, questionMetaLabel, languageLabel,
  };
}
