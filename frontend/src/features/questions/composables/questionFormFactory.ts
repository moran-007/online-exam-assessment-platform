import type { EditableProgrammingReference, QuestionForm } from '../models';

export function emptyProgrammingRef(): EditableProgrammingReference {
  return {
    externalProblemId: '',
    externalProblemUrl: '',
    platformBaseUrl: 'https://oj.example.com',
    domainId: 'system',
    domainName: 'system',
    judgeProvider: 'hydro',
    accountId: '',
    accountLabel: '',
    languagesText: 'cc.cc17o2, py.py3',
    timeLimit: null,
    memoryLimit: null,
    judgeConfig: null,
  };
}

export function baseForm(): QuestionForm {
  return {
    courseId: '',
    type: 'single_choice',
    status: 'draft',
    title: '',
    knowledgePointIds: [],
    tagNames: [],
    content: '',
    difficulty: 1,
    defaultScore: 2,
    analysis: '',
    allowOptionShuffle: false,
    programmingRef: emptyProgrammingRef(),
    children: [],
    options: [
      { optionKey: 'A', content: '', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '', isCorrect: false, sortOrder: 4 },
    ],
  };
}
