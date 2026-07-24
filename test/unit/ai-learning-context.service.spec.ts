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
    fixture.aiUserPermissions.codes.mockResolvedValue(new Set());
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
    const result = await fixture.service.build(
      '请分析题目“二次函数最值”',
      user(['ai.data.question-bank', 'question:read']),
    );
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
      user([
        'ai.data.question-bank',
        'question:read',
        'question:answer:read',
        'question:analysis:read',
        'ai.answer.direct',
      ]),
    );
    const payload = JSON.parse(result.prompt);
    expect(result.canDirectAnswer).toBe(true);
    expect(payload.questions[0].referenceAnswer).toEqual({ optionKeys: ['A'] });
    expect(payload.questions[0].analysis).toContain('最小值为 1');
    expect(payload.questions[0].options[0].isCorrect).toBe(true);
  });

  it('removes stored answers and analysis when the AI user disables those reads', async () => {
    const fixture = dependencies();
    fixture.aiUserPermissions.codes.mockResolvedValue(new Set([
      'ai.data.question-bank',
      'question:read',
    ]));
    fixture.prisma.question.findMany.mockResolvedValue([question]);

    const result = await fixture.service.build(
      '二次函数最值答案',
      user([
        'question:read',
        'question:answer:read',
        'question:analysis:read',
        'ai.answer.direct',
      ]),
    );
    const payload = JSON.parse(result.prompt);

    expect(result.canDirectAnswer).toBe(true);
    expect(payload.questions[0]).not.toHaveProperty('referenceAnswer');
    expect(payload.questions[0]).not.toHaveProperty('analysis');
    expect(payload.questions[0].options[0]).not.toHaveProperty('isCorrect');
  });

  it('does not expose questions or papers beyond the caller business permissions', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '查询二次函数题目和试卷',
      user(['ai.data.question-bank', 'ai.data.papers', 'ai.chat.general-knowledge']),
    );

    expect(fixture.prisma.question.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.paper.findMany).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
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
    fixture.aiUserPermissions.codes.mockResolvedValue(new Set(['class:read']));
    const result = await fixture.service.build('有哪些班级？', user(['class:read']));
    expect(result.blockedMessage).toContain('没有获得读取班级数据所需的权限');
    expect(fixture.prisma.classGroup.findMany).not.toHaveBeenCalled();
  });

  it('blocks the largest-class query when the AI class-data upper bound is disabled', async () => {
    const fixture = dependencies();
    fixture.aiUserPermissions.codes.mockResolvedValue(new Set(['class:read']));

    const result = await fixture.service.build(
      '哪个班级人数最多？',
      user(['class:read'], 'ADMIN'),
    );

    expect(result.blockedMessage).toContain('不能比较班级人数');
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

  it('does not disclose the question count without the caller question-read permission', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '题库中有多少可见题目',
      user(['ai.data.question-bank'], 'STUDENT'),
    );

    expect(result.blockedMessage).toContain('不能统计可见题目');
    expect(fixture.prisma.question.count).not.toHaveBeenCalled();
  });

  it('answers the visible lesson-plan count from platform data', async () => {
    const fixture = dependencies();
    fixture.prisma.lessonPlan.count.mockResolvedValue(2);
    fixture.prisma.lessonPlan.groupBy.mockResolvedValue([
      { source: 'SYSTEM', _count: { _all: 1 } },
      { source: 'PERSONAL', _count: { _all: 1 } },
    ]);

    const result = await fixture.service.build(
      '教案数量',
      user(['lesson-plan:read'], 'TEACHER'),
      { intent: 'LESSON_PLAN_OVERVIEW' } as never,
    );

    expect(result.localAnswer).toContain('当前权限范围内共有 **2 份**教案');
    expect(result.localAnswer).toContain('系统通用：**1 份**');
    expect(result.localAnswer).toContain('个人教案：**1 份**');
    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deletedAt: null,
        AND: [
          {
            OR: [
              { source: 'SYSTEM' },
              { source: 'PERSONAL', authorId: 'user-1' },
            ],
          },
        ],
      }),
    }));
  });

  it('does not turn a general lesson-plan question into a platform lookup', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '教案应该怎么写？',
      user(['lesson-plan:read', 'ai.chat.general-knowledge'], 'TEACHER'),
      { intent: 'GENERAL' } as never,
    );

    expect(fixture.prisma.lessonPlan.count).not.toHaveBeenCalled();
    expect(result.localAnswer).toBeUndefined();
    expect(result.blockedMessage).toBeUndefined();
  });

  it('keeps general lesson-plan questions out of platform lookup when classification is unavailable', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '教案和学案有什么区别？',
      user(['lesson-plan:read', 'ai.chat.general-knowledge'], 'TEACHER'),
    );

    expect(fixture.prisma.lessonPlan.count).not.toHaveBeenCalled();
    expect(result.localAnswer).toBeUndefined();
    expect(result.blockedMessage).toBeUndefined();
  });

  it('filters the lesson-plan count by the course keyword in the current question', async () => {
    const fixture = dependencies();
    fixture.prisma.lessonPlan.count.mockResolvedValue(4);
    fixture.prisma.lessonPlan.groupBy.mockResolvedValue([
      { source: 'SYSTEM', _count: { _all: 2 } },
      { source: 'PERSONAL', _count: { _all: 2 } },
    ]);

    const result = await fixture.service.build(
      'python的教案数量',
      user(['lesson-plan:read'], 'ADMIN'),
      { intent: 'LESSON_PLAN_OVERVIEW' } as never,
    );

    expect(result.localAnswer).toContain('匹配“python”');
    expect(result.localAnswer).toContain('共有 **4 份**教案');
    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { contains: 'python', mode: 'insensitive' } },
              { course: { name: { contains: 'python', mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: 'python', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it('uses the lesson-plan entity resolved from conversation history', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '那这个课程的教案有多少？',
      user(['lesson-plan:read'], 'ADMIN'),
      { intent: 'LESSON_PLAN_OVERVIEW', entityName: 'Python Basic' } as never,
    );

    expect(result.localAnswer).toContain('模糊匹配“Python Basic”');
    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { contains: 'Python Basic', mode: 'insensitive' } },
              { course: { name: { contains: 'Python Basic', mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: 'Python Basic', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it('strips the view action from a direct lesson-plan lookup', async () => {
    const fixture = dependencies();

    const result = await fixture.service.build(
      '查看 Loops 教案',
      user(['lesson-plan:read'], 'ADMIN'),
    );

    expect(result.localAnswer).toContain('模糊匹配“Loops”');
    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { contains: 'Loops', mode: 'insensitive' } },
              { course: { name: { contains: 'Loops', mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: 'Loops', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it('groups matching lesson-plan names by system and personal source when asked to list them', async () => {
    const fixture = dependencies();
    fixture.prisma.lessonPlan.count.mockResolvedValue(4);
    fixture.prisma.lessonPlan.groupBy.mockResolvedValue([
      { source: 'SYSTEM', _count: { _all: 2 } },
      { source: 'PERSONAL', _count: { _all: 2 } },
    ]);
    fixture.prisma.lessonPlan.findMany.mockResolvedValue([
      { id: 'system-1', theme: 'Loops', source: 'SYSTEM' },
      { id: 'personal-1', theme: 'Variables', source: 'PERSONAL' },
      { id: 'system-2', theme: 'Python Basic', source: 'SYSTEM' },
      { id: 'personal-2', theme: 'Input and Output', source: 'PERSONAL' },
    ]);

    const result = await fixture.service.build(
      '列出python的教案数量',
      user(['lesson-plan:read'], 'ADMIN'),
      { intent: 'LESSON_PLAN_OVERVIEW' } as never,
    );

    expect(result.localAnswer).toContain('### 系统教案（2 份）');
    expect(result.localAnswer).toContain('1. Loops');
    expect(result.localAnswer).toContain('2. Python Basic');
    expect(result.localAnswer).toContain('### 个人教案（2 份）');
    expect(result.localAnswer).toContain('1. Variables');
    expect(result.localAnswer).toContain('2. Input and Output');
    expect(result.sources).toHaveLength(4);
  });

  it('does not filter out either source when both system and personal lesson plans are requested', async () => {
    const fixture = dependencies();

    await fixture.service.build(
      '列出系统和个人教案',
      user(['lesson-plan:read'], 'ADMIN'),
      { intent: 'LESSON_PLAN_OVERVIEW' } as never,
    );

    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
      },
    });
  });

  it('preserves conjunctions that are part of a lesson-plan course name', async () => {
    const fixture = dependencies();

    await fixture.service.build(
      '道德与法治的教案数量',
      user(['lesson-plan:read'], 'ADMIN'),
    );

    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { contains: '道德与法治', mode: 'insensitive' } },
              { course: { name: { contains: '道德与法治', mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: '道德与法治', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it.each([
    ['系统工程的教案数量', '系统工程'],
    ['个人理财的教案数量', '个人理财'],
  ])('does not mistake an entity name for a lesson-plan source: %s', async (input, entityName) => {
    const fixture = dependencies();

    await fixture.service.build(
      input,
      user(['lesson-plan:read'], 'ADMIN'),
      { intent: 'LESSON_PLAN_OVERVIEW', entityName } as never,
    );

    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        AND: [
          {
            OR: [
              { theme: { contains: entityName, mode: 'insensitive' } },
              { course: { name: { contains: entityName, mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: entityName, mode: 'insensitive' } } },
            ],
          },
        ],
      },
    });
  });

  it('uses fuzzy matching and lists results for a related lesson-plan lookup', async () => {
    const fixture = dependencies();
    fixture.prisma.lessonPlan.count.mockResolvedValue(4);
    fixture.prisma.lessonPlan.groupBy.mockResolvedValue([
      { source: 'SYSTEM', _count: { _all: 2 } },
      { source: 'PERSONAL', _count: { _all: 2 } },
    ]);
    fixture.prisma.lessonPlan.findMany.mockResolvedValue([
      { id: 'system-1', theme: 'Loops', source: 'SYSTEM' },
      { id: 'personal-1', theme: 'Variables', source: 'PERSONAL' },
      { id: 'system-2', theme: 'Python Basic', source: 'SYSTEM' },
      { id: 'personal-2', theme: 'Input and Output', source: 'PERSONAL' },
    ]);

    const result = await fixture.service.build(
      '课程Python Basic相关教案',
      user(['lesson-plan:read'], 'ADMIN'),
    );

    expect(result.localAnswer).toContain('模糊匹配“Python Basic”');
    expect(result.localAnswer).toContain('### 系统教案（2 份）');
    expect(result.localAnswer).toContain('### 个人教案（2 份）');
    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { contains: 'Python Basic', mode: 'insensitive' } },
              { course: { name: { contains: 'Python Basic', mode: 'insensitive' } } },
              { knowledgePoint: { name: { contains: 'Python Basic', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it('supports an explicit exact lesson-plan lookup', async () => {
    const fixture = dependencies();

    await fixture.service.build(
      '精确查询课程“课程设计”的教案数量',
      user(['lesson-plan:read'], 'ADMIN'),
    );

    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { equals: '课程设计', mode: 'insensitive' } },
              { course: { name: { equals: '课程设计', mode: 'insensitive' } } },
              { knowledgePoint: { name: { equals: '课程设计', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
  });

  it('keeps a quoted single-character lesson-plan entity in local fallback matching', async () => {
    const fixture = dependencies();

    await fixture.service.build(
      '精确查询课程“C”的教案数量',
      user(['lesson-plan:read'], 'ADMIN'),
    );

    expect(fixture.prisma.lessonPlan.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { theme: { equals: 'C', mode: 'insensitive' } },
              { course: { name: { equals: 'C', mode: 'insensitive' } } },
              { knowledgePoint: { name: { equals: 'C', mode: 'insensitive' } } },
            ],
          },
        ],
      }),
    });
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
      lessonPlan: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const dataScope = {
      academicClassIdsFor: jest.fn().mockResolvedValue(null),
      studentIdsFor: jest.fn().mockResolvedValue(null),
      teacherIdsVisibleTo: jest.fn().mockResolvedValue(null),
      examWhere: jest.fn().mockResolvedValue({}),
    };
    const aiUserPermissions = {
      codes: jest.fn().mockResolvedValue(new Set([
        'ai.data.question-bank', 'question:read',
        'question:answer:read', 'question:analysis:read',
        'ai.data.papers', 'paper:read',
        'ai.data.classes', 'class:read',
        'ai.data.exams', 'exam:read',
        'ai.data.grade-history', 'grading:score:read',
        'ai.data.attendance', 'attendance:read',
        'ai.data.schedule', 'schedule:read',
        'ai.data.student-identity', 'student:identity:read',
        'ai.data.teacher-identity', 'academic-profile:read',
        'ai.data.teacher-materials', 'lesson-record:read',
        'ai.data.lesson-plans', 'lesson-plan:read',
      ])),
    };
    return {
      prisma,
      dataScope,
      aiUserPermissions,
      service: new AiLearningContextService(prisma as never, dataScope as never, aiUserPermissions as never),
    };
  }

  function user(permissions: string[], userType = 'STUDENT') {
    return { id: 'user-1', userType, permissions, roles: [] } as never;
  }
});
