import {
  alignGeneratedTeachingProcess,
  buildStageLessonPlanPrompt,
  buildTimeAllocationPrompt,
  LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION,
  normalizeGeneratedLessonPlanText,
  type LessonPlanPromptContext,
} from '../../frontend/src/features/lesson-records/composables/lessonPlanGeneration';
import type { TeachingProcessStage } from '../../frontend/src/features/lesson-records/composables/useLessonPlanCatalog';

function stage(id: string, title: string, teacherActivity = ''): TeachingProcessStage {
  return {
    id,
    title,
    duration: 10,
    coreQuestion: '',
    teacherActivity,
    studentActivity: '',
    assessment: '',
    designIntent: '',
    resources: '',
  };
}

const context: LessonPlanPromptContext = {
  courseName: '初中数学',
  knowledgePointName: '一次函数',
  topic: '一次函数图像',
  gradeLevel: '八年级',
  durationMinutes: 45,
  templateName: '讲练结合',
  templateContent: '以问题链组织教学。',
  requirements: '',
  processBlueprint: [],
};

describe('lesson plan generation helpers', () => {
  it('requires the stage revision request while preserving stage identity', () => {
    const prompt = buildStageLessonPlanPrompt({
      context,
      stage: stage('stage-1', '巩固练习', '1. 完成基础题。'),
      knowledgeObjectives: '理解一次函数图像。',
      learnerAnalysis: '',
      teachingContent: '一次函数图像。',
      keyPoints: '图像特征。',
      difficultPoints: '斜率意义。',
      teachingMethods: '讲练结合。',
      adjacentStages: '上一环节：新知探究',
      revisionRequest: '增加一道分层例题，并补充典型错误反馈。',
    });

    expect(prompt).toContain('【本环节修改意见】增加一道分层例题，并补充典型错误反馈。');
    expect(prompt).toContain('保持当前环节名称和时长不变');
    expect(prompt.length).toBeLessThanOrEqual(19_500);
  });

  it('maps duplicate stage titles by position without reusing the first result', () => {
    const blueprint = [
      stage('stage-1', '练习'),
      stage('stage-2', '练习'),
    ];
    const generated = [
      stage('generated-1', '练习', '1. 基础练习。'),
      stage('generated-2', '练习', '1. 提高练习。'),
    ];

    const aligned = alignGeneratedTeachingProcess(blueprint, generated);

    expect(aligned.map((item) => item.id)).toEqual(['stage-1', 'stage-2']);
    expect(aligned.map((item) => item.teacherActivity)).toEqual([
      '1. 基础练习。',
      '1. 提高练习。',
    ]);
  });

  it('requests indexed time-only allocation without exposing editable content fields', () => {
    const prompt = buildTimeAllocationPrompt({
      courseName: '信息技术',
      topic: 'C++ 基础语法',
      gradeLevel: '七年级',
      totalMinutes: 45,
      stages: [stage('stage-1', '导入新课'), stage('stage-2', '精讲示范')],
    });

    expect(LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION).toContain('"index":1');
    expect(LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION.length).toBeLessThanOrEqual(500);
    expect(prompt).toContain('总课时：45 分钟');
    expect(prompt).toContain('"index":1');
    expect(prompt).toContain('不得机械平均');
    expect(prompt.length).toBeLessThanOrEqual(19_500);
  });

  it('promotes a complete inline program while keeping short identifiers inline', () => {
    const normalized = normalizeGeneratedLessonPlanText(
      '变量 `count` 用于计数。示例：`#include <iostream> using namespace std; int main() { cout << "Hi"; return 0; }`',
    );

    expect(normalized).toContain('变量 `count`');
    expect(normalized).toContain('```cpp\n#include <iostream>');
    expect(normalized).not.toContain('示例：`#include');
  });

  it('does not rewrite spacing inside an existing fenced code block', () => {
    const source = '示例：\n```cpp\nint main() {\n\n\n  return 0;\n}\n```\n结束。';

    expect(normalizeGeneratedLessonPlanText(source)).toContain(
      '```cpp\nint main() {\n\n\n  return 0;\n}\n```',
    );
  });
});
