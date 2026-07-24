import { AiLearningContextService } from '../../src/modules/ai/ai-learning-context.service';

describe('AiLearningContextService', () => {
  const question = {
    id: 'question-1', title: '二次函数最值', content: '求函数的最小值', type: 'SINGLE_CHOICE',
    difficulty: 2, status: 'PUBLISHED', analysis: '配方法后最小值为 1',
    course: { name: '数学' },
    options: [
      { optionKey: 'A', content: '1', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: '2', isCorrect: false, sortOrder: 2 },
    ],
    answer: { answerJson: { optionKeys: ['A'] }, scoringRuleJson: null },
    knowledgePoints: [{ knowledgePoint: { name: '二次函数' } }],
  };

  it('does not query platform data without independent AI data permissions', async () => {
    const fixture = dependencies();
    const result = await fixture.service.build('分析二次函数最值', user([]));
    expect(result.sources).toEqual([]);
    expect(fixture.prisma.question.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.paper.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.classGroup.findMany).not.toHaveBeenCalled();
    expect(result.blockedMessage).toContain('仅限平台内容');
  });

  it('allows general knowledge questions without a matching platform record when configured', async () => {
    const fixture = dependencies();
    const result = await fixture.service.build('C++ 知识点 DFS', user(['ai.chat.general-knowledge']));
    expect(result.canGeneralKnowledge).toBe(true);
    expect(result.blockedMessage).toBeUndefined();
  });

  it('retrieves published questions for guided-only roles and removes answers', async () => {
    const fixture = dependencies();
    fixture.prisma.question.findMany.mockResolvedValue([question]);
    const result = await fixture.service.build('请分析题目“二次函数最值”', user(['ai.data.question-bank']));
    const payload = JSON.parse(result.prompt);
    expect(result.sources).toEqual([{ type: 'question', id: 'question-1', name: '二次函数最值' }]);
    expect(result.canDirectAnswer).toBe(false);
    expect(fixture.prisma.question.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PUBLISHED' }),
    }));
    expect(payload.questions[0]).not.toHaveProperty('referenceAnswer');
    expect(payload.questions[0]).not.toHaveProperty('analysis');
    expect(payload.questions[0].options[0]).not.toHaveProperty('isCorrect');
  });

  it('includes reference answers only when the role has direct-answer permission', async () => {
    const fixture = dependencies();
    fixture.prisma.question.findMany.mockResolvedValue([question]);
    const result = await fixture.service.build(
      '二次函数最值答案',
      user(['ai.data.question-bank', 'ai.answer.direct']),
    );
    const payload = JSON.parse(result.prompt);
    expect(result.canDirectAnswer).toBe(true);
    expect(payload.questions[0].referenceAnswer).toEqual({ optionKeys: ['A'] });
    expect(payload.questions[0].analysis).toContain('最小值为 1');
    expect(payload.questions[0].options[0].isCorrect).toBe(true);
  });

  it('returns the exact empty-class list from the scoped database query without asking a model', async () => {
    const fixture = dependencies();
    fixture.prisma.classGroup.findMany.mockResolvedValue([
      { id: 'class-1', name: 'Python A 班', code: 'PY-A', course: { name: 'Python' }, students: [], teachers: [{ id: 'teacher-1' }] },
      { id: 'class-2', name: 'Scratch B 班', code: 'SC-B', course: { name: 'Scratch' }, students: [{ id: 'student-1' }], teachers: [] },
    ]);

    const result = await fixture.service.build(
      '目前有多少个空班级，分别是哪些班级？',
      user(['ai.data.classes', 'class:read'], 'SUPER_ADMIN'),
    );

    expect(fixture.dataScope.academicClassIdsFor).toHaveBeenCalled();
    expect(result.localAnswer).toContain('## 空班级统计');
    expect(result.localAnswer).toContain('当前共有 **1 个**空班级');
    expect(result.localAnswer).toContain('1. Python A 班');
    expect(result.sources).toEqual([{ type: 'class', id: 'class-1', name: 'Python A 班' }]);
  });

  it('blocks factual class queries when either the AI or business permission is missing', async () => {
    const fixture = dependencies();
    const result = await fixture.service.build('有哪些班级？', user(['class:read']));
    expect(result.blockedMessage).toContain('没有获得读取班级数据所需的权限');
    expect(fixture.prisma.classGroup.findMany).not.toHaveBeenCalled();
  });

  it('answers the combined teacher assignment question instead of returning a class list', async () => {
    const fixture = dependencies();
    fixture.prisma.user.findMany.mockResolvedValue([
      { id: 'teacher-1', realName: '张老师', username: 'teacher01', teachingClasses: [{ classGroup: { name: 'A 班' } }] },
      { id: 'teacher-2', realName: '李老师', username: 'teacher02', teachingClasses: [] },
    ]);
    const result = await fixture.service.build(
      '当前有多少老师有所属班级，有多少没有，分别是谁',
      user(['ai.data.teacher-identity', 'academic-profile:read', 'class:read'], 'ADMIN'),
      { intent: 'UNASSIGNED_TEACHERS' },
    );
    expect(result.localAnswer).toContain('2 名有效教师，其中 1 名已带班、1 名未带班');
    expect(result.localAnswer).toContain('| 教师 | 状态 | 所属班级 |');
    expect(result.localAnswer).toContain('| 张老师（teacher01） | 已带班 | A 班 |');
    expect(result.localAnswer).toContain('| 李老师（teacher02） | **未带班** | — |');
    expect(fixture.prisma.classGroup.findMany).not.toHaveBeenCalled();
  });

  it('uses the model classification for semantically equivalent local-data wording', async () => {
    const fixture = dependencies();
    fixture.prisma.user.findMany.mockResolvedValue([
      { id: 'student-1', realName: '王同学', username: 'student01' },
    ]);

    const result = await fixture.service.build(
      '请把还没进入教学组织的孩子列出来',
      user(['ai.data.student-identity', 'student:identity:read'], 'ADMIN'),
      { intent: 'UNASSIGNED_STUDENTS' },
    );

    expect(result.localAnswer).toContain('当前权限范围内共有 **1 名**有效学生未分配到启用班级');
    expect(result.localAnswer).toContain('1. 王同学（student01）');
    expect(fixture.prisma.user.findMany).toHaveBeenCalled();
  });

  it('prefers the longest matching exam name for score extremes', async () => {
    const fixture = dependencies();
    fixture.prisma.exam.findMany.mockResolvedValue([
      { id: 'exam-1', name: '测试' }, { id: 'exam-2', name: '编程测试' }, { id: 'exam-3', name: '编程测试1' },
    ]);
    fixture.prisma.examAttempt.findMany.mockResolvedValue([
      { id: 'attempt-1', studentId: 'student-1', totalScore: 100 },
      { id: 'attempt-2', studentId: 'student-2', totalScore: 60 },
    ]);
    fixture.prisma.user.findMany.mockResolvedValue([
      { id: 'student-1', realName: '高分同学', username: 's1' },
      { id: 'student-2', realName: '低分同学', username: 's2' },
    ]);
    const result = await fixture.service.build(
      '编程测试1考试中成绩最高的是，成绩最低的是',
      user(['ai.data.grade-history', 'grading:score:read', 'exam:read', 'ai.data.student-identity', 'student:identity:read'], 'ADMIN'),
    );
    expect(fixture.prisma.examAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ examId: 'exam-3' }) }));
    expect(result.localAnswer).toContain('- 统计学生：**2 名**');
    expect(result.localAnswer).toContain('- 已评分作答：**2 份**');
    expect(result.localAnswer).toContain('最高分 100 分：高分同学（s1）');
    expect(result.localAnswer).toContain('最低分 60 分：低分同学（s2）');
  });

  it('counts all non-deleted questions for a question manager', async () => {
    const fixture = dependencies();
    fixture.prisma.question.count.mockResolvedValue(345);
    const result = await fixture.service.build('题库中有多少可见题目', user(['ai.data.question-bank', 'question:read'], 'ADMIN'));
    expect(result.localAnswer).toContain('345 道未删除题目');
  });

  function dependencies() {
    const prisma = {
      question: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      paper: { findMany: jest.fn().mockResolvedValue([]) },
      classGroup: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      lessonSession: { findMany: jest.fn().mockResolvedValue([]) },
      classScheduleRule: { findMany: jest.fn().mockResolvedValue([]) },
      exam: { findMany: jest.fn().mockResolvedValue([]) },
      examAttempt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const dataScope = {
      academicClassIdsFor: jest.fn().mockResolvedValue(null),
      studentIdsFor: jest.fn().mockResolvedValue(null),
      teacherIdsVisibleTo: jest.fn().mockResolvedValue(null),
      examWhere: jest.fn().mockResolvedValue({}),
    };
    return { prisma, dataScope, service: new AiLearningContextService(prisma as never, dataScope as never) };
  }

  function user(permissions: string[], userType = 'STUDENT') {
    return { id: 'user-1', userType, permissions, roles: [] } as never;
  }
});
