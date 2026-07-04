const definitions = [
  ['single_choice', '单选题', 'choice'],
  ['multiple_choice', '多选题', 'choice'],
  ['true_false', '判断题', 'choice'],
  ['fill_blank', '填空题', 'fill-blank'],
  ['short_answer', '简答题', 'text'],
  ['programming', '编程题', 'programming'],
  ['file_upload', '文件上传题', 'text'],
  ['scratch_project', 'Scratch 项目题', 'text'],
  ['arduino_project', 'Arduino 项目题', 'text'],
  ['material', '材料/组合题', 'material'],
];

const registry = new Map(definitions.map(([code, label, answerAdapter]) => [code, {
  code,
  label,
  version: 1,
  editorAdapter: `${answerAdapter}-editor`,
  answerAdapter,
  reviewAdapter: `${answerAdapter}-review`,
}]));

export function questionTypeDefinition(type) {
  return registry.get(String(type || '').replaceAll('-', '_').toLowerCase()) || null;
}

export function questionTypeLabel(type) {
  return questionTypeDefinition(type)?.label || String(type || '未知题型');
}

export function registeredQuestionTypes() {
  return [...registry.values()];
}
