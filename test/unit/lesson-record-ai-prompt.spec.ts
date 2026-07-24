import {
  buildLessonRecordAiPromptContent,
  LESSON_RECORD_AI_CONTENT_SAFE_BUDGET,
} from '../../frontend/src/features/lesson-records/composables/lessonRecordAiPrompt';
import type {
  LessonPlan,
  TeachingProcessStage,
} from '../../frontend/src/features/lesson-records/composables/useLessonPlanCatalog';

describe('lesson record AI prompt boundary', () => {
  it('keeps source, signature and every teaching stage while deterministically fitting the API budget', () => {
    const plan = oversizedLessonPlan();
    expect(JSON.stringify(plan).length).toBeGreaterThan(20_000);

    const input = {
      plan,
      sessionTitle: '超声与次声课堂记录',
      actualTeachingNotes: `实际调整起始：${'课堂调整。'.repeat(5_000)}`,
      classPerformance: `课堂表现起始：${'学生观察。'.repeat(5_000)}`,
    };
    const first = buildLessonRecordAiPromptContent(input);
    const second = buildLessonRecordAiPromptContent(input);

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(LESSON_RECORD_AI_CONTENT_SAFE_BUDGET);
    expect(first.length).toBeLessThan(20_000);
    expect(first).toContain('教案来源：教师个人教案');
    expect(first).toContain('署名/上传者：张老师');
    expect(first).toContain('1. 教学环节-01（2分钟）');
    expect(first).toContain('30. 教学环节-30（31分钟）');
    expect(first).toContain('教师活动：');
    expect(first).toContain('学生活动：');
    expect(first).toContain('实际上课记录：实际调整起始');
    expect(first).toContain('真实课堂表现：课堂表现起始');
    expect(first).toContain('内容已按 AI 输入上限截断');
  });
});

function oversizedLessonPlan(): LessonPlan {
  const longText = '请观察实验现象，说明理由并结合公式 $v=s/t$ 完成课堂任务。\n'.repeat(600);
  const teachingProcess: TeachingProcessStage[] = Array.from({ length: 30 }, (_, index) => ({
    id: `stage-${index + 1}`,
    title: `教学环节-${String(index + 1).padStart(2, '0')}`,
    duration: index + 2,
    coreQuestion: `核心问题 ${index + 1}：${longText}`,
    teacherActivity: `教师活动 ${index + 1}：${longText}`,
    studentActivity: `学生活动 ${index + 1}：${longText}`,
    assessment: `评价 ${index + 1}：${longText}`,
    designIntent: `设计意图 ${index + 1}：${longText}`,
    resources: `资源 ${index + 1}：${longText}`,
  }));
  return {
    id: 'plan-1',
    source: 'PERSONAL',
    authorId: 'teacher-1',
    authorName: '张老师',
    courseId: 'course-1',
    knowledgePointId: 'knowledge-1',
    theme: '超声与次声',
    scheduledAt: '2026-07-23 10:00',
    classroom: '物理实验室',
    instructorName: '张老师',
    gradeLevel: '八年级',
    durationMinutes: 45,
    learnerAnalysis: longText,
    knowledgeObjectives: longText,
    processObjectives: longText,
    valueObjectives: longText,
    coreCompetencies: longText,
    keyPoints: longText,
    difficultPoints: longText,
    doubtfulPoints: longText,
    teachingContent: longText,
    teachingMethods: longText,
    teachingMeans: longText,
    preparation: longText,
    teachingProcess,
    homework: longText,
    assessment: longText,
    boardDesign: longText,
    reflection: longText,
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
  };
}
