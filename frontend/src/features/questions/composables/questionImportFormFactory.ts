import { emptyFillBlankRows } from '../../../utils/fillBlankAnswers';
import type {
  EditableProgrammingReference,
  MaterialQuestionChild,
  SingleQuestionForm,
} from '../models';

type TypeOption = { value: string };
const LAST_SINGLE_TYPE_KEY = 'question-import-last-single-type';

export function normalizeQuestionImportType(value: unknown) {
  const key = String(value || '').trim().toLowerCase();
  const map: Record<string, string> = {
    单选: 'single_choice', 单选题: 'single_choice', single: 'single_choice', single_choice: 'single_choice',
    多选: 'multiple_choice', 多选题: 'multiple_choice', multiple: 'multiple_choice', multiple_choice: 'multiple_choice',
    判断: 'true_false', 判断题: 'true_false', true_false: 'true_false',
    填空: 'fill_blank', 填空题: 'fill_blank', fill_blank: 'fill_blank',
    简答: 'short_answer', 简答题: 'short_answer', short_answer: 'short_answer',
    编程: 'programming', 编程题: 'programming', programming: 'programming',
    材料: 'material', 材料题: 'material', '材料/组合题': 'material', 组合题: 'material',
    大题: 'material', '大题/组合题': 'material', 多问题: 'material', 多问简答: 'material', material: 'material',
    文件上传: 'file_upload', 文件上传题: 'file_upload', file_upload: 'file_upload',
    scratch: 'scratch_project', scratch_project: 'scratch_project',
    arduino: 'arduino_project', arduino_project: 'arduino_project',
  };
  return map[key] ?? key;
}

export function readRememberedSingleType(typeOptions: TypeOption[]) {
  try {
    const remembered = normalizeQuestionImportType(localStorage.getItem(LAST_SINGLE_TYPE_KEY));
    return typeOptions.some((item) => item.value === remembered) ? remembered : '';
  } catch {
    return '';
  }
}

export function rememberSingleType(type: string, typeOptions: TypeOption[]) {
  const normalized = normalizeQuestionImportType(type);
  if (!typeOptions.some((item) => item.value === normalized)) return;
  try {
    localStorage.setItem(LAST_SINGLE_TYPE_KEY, normalized);
  } catch {
    // Storage is optional; importing must continue when it is unavailable.
  }
}

export function emptyProgrammingRef(): EditableProgrammingReference {
  return {
    externalProblemId: '', externalProblemUrl: '', platformBaseUrl: 'https://oj.example.com',
    domainId: 'system', domainName: 'system', judgeProvider: 'hydro', accountId: '', accountLabel: '',
    languagesText: 'cc.cc17o2, py.py3', timeLimit: null, memoryLimit: null, judgeConfig: null,
  };
}

export function baseSingleForm(typeOptions: TypeOption[]): SingleQuestionForm {
  return {
    type: readRememberedSingleType(typeOptions) || 'single_choice', title: '', content: '', difficulty: 1,
    defaultScore: 2, answerRows: 6, analysis: '', programmingRef: emptyProgrammingRef(), children: [],
    options: [
      { optionKey: 'A', content: '', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '', isCorrect: false, sortOrder: 4 },
    ],
  };
}

export function createMaterialChildDraft(type = 'short_answer'): MaterialQuestionChild {
  return {
    localId: '', type, title: '', content: '', difficulty: 1, score: 2, answerRows: 6,
    analysis: '', answerText: '', blankRows: emptyFillBlankRows(), sortOrder: 1, options: [],
  };
}

export { LAST_SINGLE_TYPE_KEY };
