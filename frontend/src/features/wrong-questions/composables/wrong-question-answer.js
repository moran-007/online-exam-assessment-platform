const DEFAULT_LANGUAGE = 'cc.cc17o2';

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
  cpp17: 'C++17',
  python3: 'Python 3',
  java: 'Java',
  c: 'C',
  cc: 'C++',
  pas: 'Pascal',
};

const MASTERY_LABELS = {
  unmastered: '未掌握',
  reviewing: '复习中',
  mastered: '已掌握',
  ignored: '已移出',
};

const SOURCE_LABELS = {
  exam: '考试',
  practice: '练习',
  manual: '手动',
  ai_recommendation: '推荐',
};

const EVENT_LABELS = {
  exam_wrong: '考试错题',
  practice_wrong: '练习答错',
  practice_correct: '练习答对',
  manual_add: '手动加入',
  status_change: '状态调整',
};

export function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : [DEFAULT_LANGUAGE, 'py.py3', 'java'];
}

export function languageLabel(language) {
  return LANGUAGE_LABELS[language] ?? language;
}

export function emptyAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || DEFAULT_LANGUAGE,
  };
}

export function answerPayload(answer) {
  const selectedOptionIds = answer.selectedOptionIds.filter(Boolean);
  if (selectedOptionIds.length) return { selectedOptionIds };
  if (answer.blanks.some((blank) => String(blank.value ?? '').trim())) return { blanks: answer.blanks };
  if (String(answer.text ?? '').trim()) return { text: answer.text };
  if (String(answer.code ?? '').trim()) {
    return {
      text: answer.code,
      extra: {
        code: answer.code,
        language: answer.language || DEFAULT_LANGUAGE,
      },
    };
  }
  return {};
}

export function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
  return Array.from({ length: count }, (_, index) => {
    const blankIndex = index + 1;
    const current = source.find((blank) => Number(blank?.index) === blankIndex);
    return { index: blankIndex, value: current?.value ?? '' };
  });
}

export function masteryLabel(value) {
  return MASTERY_LABELS[value] ?? value;
}

export function sourceLabel(value) {
  return SOURCE_LABELS[value] ?? value;
}

export function eventLabel(value) {
  return EVENT_LABELS[value] ?? value;
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

export function formatShortDate(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

export function masteryBarWidth(value, masteryCurve) {
  const max = Math.max(
    1,
    ...masteryCurve.flatMap((item) => [item.wrong || 0, item.mastered || 0, item.manual || 0]),
  );
  return `${Math.max(8, Math.round(((value || 0) / max) * 100))}%`;
}

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  const matches = String(question?.content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
  return Math.max(1, matches?.length || 0);
}
