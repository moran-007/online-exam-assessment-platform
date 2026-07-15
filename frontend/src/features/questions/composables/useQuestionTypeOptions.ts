const baseOptions = [
  { label: '单选题', value: 'single_choice' },
  { label: '多选题', value: 'multiple_choice' },
  { label: '判断题', value: 'true_false' },
  { label: '填空题', value: 'fill_blank' },
  { label: '简答题', value: 'short_answer' },
  { label: '编程题', value: 'programming' },
  { label: '材料/组合题', value: 'material' },
  { label: '文件上传题', value: 'file_upload' },
  { label: 'Scratch 项目题', value: 'scratch_project' },
  { label: 'Arduino 项目题', value: 'arduino_project' },
] as const;

export function useQuestionTypeOptions(importLabels = false) {
  const typeOptions = baseOptions.map((option) => {
    if (!importLabels) return option;
    if (option.value === 'short_answer') return { ...option, label: '简答题（单问）' };
    if (option.value === 'material') return { ...option, label: '大题/组合题（材料/多问）' };
    return option;
  });
  const materialChildTypeOptions = baseOptions
    .filter((option) => !['programming', 'material'].includes(option.value))
    .map((option) => ({ ...option, label: option.label.replace(/题$/, '小题') }));
  return { typeOptions, materialChildTypeOptions };
}
