const definitions = [
  { code: 'single_choice', label: '单选题', family: 'choice', answerAdapter: 'choice', objective: true, autoGradable: true },
  { code: 'multiple_choice', label: '多选题', family: 'choice', answerAdapter: 'choice', objective: true, autoGradable: true },
  { code: 'true_false', label: '判断题', family: 'choice', answerAdapter: 'choice', objective: true, autoGradable: true },
  { code: 'fill_blank', label: '填空题', family: 'fill-blank', answerAdapter: 'fill-blank', objective: true, autoGradable: true },
  { code: 'short_answer', label: '简答题', family: 'text', answerAdapter: 'text', objective: false, autoGradable: false },
  { code: 'programming', label: '编程题', family: 'programming', answerAdapter: 'programming', objective: false, autoGradable: true },
  { code: 'file_upload', label: '文件上传题', family: 'attachment', answerAdapter: 'text', objective: false, autoGradable: false },
  { code: 'scratch_project', label: 'Scratch 项目题', family: 'project', answerAdapter: 'text', objective: false, autoGradable: false },
  { code: 'arduino_project', label: 'Arduino 项目题', family: 'project', answerAdapter: 'text', objective: false, autoGradable: false },
  { code: 'material', label: '材料/组合题', family: 'material', answerAdapter: 'material', objective: false, autoGradable: false },
];

const registry = new Map(definitions.map((definition) => [definition.code, {
  version: 1,
  editorAdapter: `${definition.answerAdapter}-editor`,
  reviewAdapter: `${definition.answerAdapter}-review`,
  ...definition,
}]));

export function normalizeQuestionType(type) {
  return String(type || '').replaceAll('-', '_').toLowerCase();
}

export function questionTypeDefinition(type) {
  return registry.get(normalizeQuestionType(type)) || null;
}

export function questionTypeLabel(type) {
  return questionTypeDefinition(type)?.label || String(type || '未知题型');
}

export function registeredQuestionTypes() {
  return [...registry.values()];
}

export function isObjectiveQuestionType(type) {
  return Boolean(questionTypeDefinition(type)?.objective);
}

export function isProgrammingQuestionType(type) {
  return normalizeQuestionType(type) === 'programming';
}

export function isMaterialQuestionType(type) {
  return normalizeQuestionType(type) === 'material';
}
