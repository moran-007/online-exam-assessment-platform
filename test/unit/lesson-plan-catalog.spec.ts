jest.mock('../../frontend/src/features/lesson-records/api', () => ({
  createLessonPlan: jest.fn(),
  listLessonPlans: jest.fn(),
  removeLessonPlan: jest.fn(),
  updateLessonPlan: jest.fn(),
}));

import {
  createTeachingProcessStage,
  emptyLessonPlan,
  isLessonPlanReady,
  useLessonPlanCatalog,
} from '../../frontend/src/features/lesson-records/composables/useLessonPlanCatalog';

describe('useLessonPlanCatalog', () => {
  it('does not reuse lesson plan state across composable instances', () => {
    const firstSession = useLessonPlanCatalog();
    const secondSession = useLessonPlanCatalog();

    firstSession.plans.value.push({
      ...emptyLessonPlan(),
      id: 'private-plan',
      authorId: 'teacher-a',
      authorName: '张老师',
      courseId: 'course-a',
      theme: '账号 A 的个人教案',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    });

    expect(secondSession.plans.value).toEqual([]);
  });

  it('treats optional teaching fields as optional while requiring a usable process', () => {
    const stage = createTeachingProcessStage({
      title: '探究新知',
      duration: 45,
      teacherActivity: '1. 提出问题并示范。',
      studentActivity: '1. 讨论并提交结论。',
    });
    const plan = {
      ...emptyLessonPlan(),
      id: 'ready-plan',
      authorId: 'teacher-a',
      authorName: '张老师',
      courseId: 'course-a',
      theme: '一次函数',
      knowledgeObjectives: '理解一次函数概念。',
      teachingContent: '一次函数的概念与图像。',
      keyPoints: '概念辨析。',
      difficultPoints: '图像意义。',
      teachingProcess: [stage],
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    };

    expect(isLessonPlanReady(plan)).toBe(true);
    expect(isLessonPlanReady({
      ...plan,
      teachingProcess: [{ ...stage, studentActivity: '' }],
    })).toBe(false);
  });
});
