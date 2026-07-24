import {
  ClassMemberStatus,
  PermissionType,
  PaperStatus,
  PaperType,
  PrismaClient,
  QuestionStatus,
  QuestionType,
  TagType,
  UserStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  AI_USER_ROLE_CODE,
  AI_USER_ROLE_NAME,
  isAiReadablePermission,
} from '../src/common/security/ai-user-permissions';

const prisma = new PrismaClient();

export const permissions = [
  ['course:read', '查看课程'], ['course:create', '新增课程'], ['course:update', '修改课程'],
  ['knowledge-point:read', '查看知识点'], ['knowledge-point:create', '新增知识点'], ['knowledge-point:update', '修改知识点'],
  ['tag:read', '查看标签'], ['tag:create', '新增标签'], ['tag:update', '修改标签'],
  ['question:read', '题库管理（兼容总权限）'], ['question:create', '新增题目'], ['question:update', '修改题目'],
  ['question:publish', '发布题目'], ['question:delete', '删除题目'],
  ['question:answer:read', '查看参考答案'], ['question:analysis:read', '查看题目解析'],
  ['paper:read', '查看试卷'], ['paper:create', '新增试卷'], ['paper:update', '修改试卷'], ['paper:publish', '发布试卷'],
  ['exam:read', '查看考试'], ['exam:create', '新增考试'], ['exam:update', '修改考试'], ['exam:delete', '删除考试'], ['exam:publish', '发布考试'],
  ['exam:result:read', '查看考试结果（兼容总权限）'], ['exam:result:export', '导出考试结果（兼容总权限）'],
  ['exam:answer:read', '查看学生作答'], ['student:identity:read', '查看学生身份信息'],
  ['class:read', '查看班级'], ['class:create', '新增班级'], ['class:update', '修改班级'],
  ['grading:read', '查看批改任务（兼容总权限）'], ['grading:update', '执行批改（兼容总权限）'],
  ['grading:score:read', '查看成绩'], ['grading:score:update', '修改成绩'], ['grading:rubric:update', '按评分量表批改'],
  ['grading:regrade:preview', '试算重判'], ['grading:regrade:confirm', '确认重判'],
  ['export:task:create', '创建导出任务'], ['export:task:read', '查看导出任务'], ['export:file:download', '下载导出文件'],
  ['attachment:preview', '预览附件'], ['attachment:download', '下载附件'],
  ['hydro:platform:manage', '管理 Hydro 平台'], ['hydro:problem:bind', '绑定 Hydro 题目'],
  ['hydro:account:read', '查看 Hydro 账号'], ['hydro:account:update', '修改 Hydro 账号'], ['hydro:result:write', '写入 Hydro 结果'],
  ['ai.summary.exam.generate', '生成考试总结'], ['ai.summary.student.generate', '生成学生总结'],
  ['ai.chat.use', '使用 AI 问答助手'],
  ['ai.chat.general-knowledge', 'AI 通用知识问答'],
  ['ai.data.question-bank', 'AI 读取题库'],
  ['ai.data.papers', 'AI 读取试卷'],
  ['ai.data.classes', 'AI 读取班级'],
  ['ai.data.exams', 'AI 读取考试安排'],
  ['ai.answer.direct', 'AI 直接给出答案'],
  ['ai.data.grade-history', 'AI 读取成绩历史'],
  ['ai.data.attendance', 'AI 读取出勤情况'],
  ['ai.data.schedule', 'AI 读取排课情况'],
  ['ai.data.student-identity', 'AI 使用学生实名'],
  ['ai.data.teacher-identity', 'AI 使用教师实名'],
  ['ai.data.teacher-materials', 'AI 读取教师教学资料'],
  ['ai.data.lesson-plans', 'AI 读取教案'],
  ['ai.user.manage', '管理 AI 用户读取权限'],
  ['ai.summary.class.generate', '生成班级总结'], ['ai.summary.parent-report.generate', '生成家长报告'],
  ['ai.summary.lesson.generate', '生成课堂助手草稿'],
  ['ai.summary.review', '审核 AI 总结'], ['ai.summary.publish', '发布 AI 总结'],
  ['ai.summary.revoke', '撤回 AI 总结'], ['ai.summary.view-own', '查看本人已发布 AI 总结'],
  ['ai.summary.view-class', '查看班级 AI 总结'], ['ai.prompt.manage', '管理 AI 提示模板'],
  ['ai.feedback.create', '提交 AI 质量反馈'], ['ai.quality.read', '查看 AI 质量看板'],
  ['ai.quality.manage', '处置 AI 反馈与模型回归'],
  ['ai.provider.manage', '管理 AI 模型配置'],
  ['ai.provider.manage-own', '管理个人 AI 模型配置'],
  ['academic-profile:read', '按数据范围查看教务档案'],
  ['academic-profile:update', '维护学生和教师档案'],
  ['parent-student:manage', '维护家长与学生关系'],
  ['legacy-migration:manage', '预检、处置和批准历史数据迁移'],
  ['lesson-type:read', '查看课型'], ['lesson-type:manage', '管理课型'],
  ['course-unit:read', '查看课程单元模板'], ['course-unit:manage', '管理课程单元模板'],
  ['schedule:read', '按数据范围查看排课'], ['schedule:manage', '维护规则、生成课次和调课'],
  ['attendance:read', '按数据范围查看考勤'], ['attendance:confirm', '确认考勤并扣减课时'],
  ['attendance:correct', '通过冲正台账更正考勤'],
  ['lesson-hour:read', '按数据范围查看课时余额与台账'],
  ['lesson-hour:adjust', '新增购买、赠送、退款和人工调整'],
  ['lesson-hour:reconcile', '重算并核对课时台账'],
  ['lesson-record:read', '按数据范围查看教学记录和已发布学习内容'],
  ['lesson-record:manage', '保存草稿、提交教学记录和维护附件'],
  ['lesson-record:publish', '审核并发布教学记录'],
  ['lesson-plan:read', '查看教案、教案模板和教学流程预设'],
  ['lesson-plan:manage', '创建、修改和删除教案及个人预设'],
  ['lesson-asset:manage', '上传和移除课次附件'],
  ['lesson-asset:download', '在教学记录数据范围内预览和下载附件'],
  ['scratch-template:read', '查看可用 Scratch 模板元数据'],
  ['scratch-template:manage', '上传、修改和归档 Scratch 模板'],
  ['scratch-assignment:read', '按课次和学习者范围查看 Scratch 任务'],
  ['scratch-assignment:manage', '绑定模板并维护 Scratch 任务草稿'],
  ['scratch-assignment:publish', '发布或归档 Scratch 课堂任务'],
  ['scratch-work:read', '按数据范围查看 Scratch 作品和版本'],
  ['scratch-work:save', '保存本人 Scratch 作品的新版本'],
  ['scratch-work:submit', '提交本人 Scratch 作品'],
  ['scratch-work:review', '为任教课次作品追加评分和点评'],
  ['scratch-asset:download', '按作品与模板数据范围下载 Scratch 文件'],
  ['scratch-judge:manage', '重试和查看外部运行时判定任务'],
  ['statistics:read', '查看统计'], ['dashboard:read', '按数据范围查看融合看板'], ['audit-log:read', '查看审计日志'],
] as const;

export function getAiUserSeedPermissionCodes(
  allPermissionCodes: readonly string[],
  excludedPermissionCodes: ReadonlySet<string>,
) {
  return allPermissionCodes.filter((code) =>
    isAiReadablePermission(code)
    && !excludedPermissionCodes.has(code));
}

async function main() {
  for (const [code, name] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name, description: name },
      create: {
        code,
        name,
        description: name,
        type: PermissionType.API,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const allPermissionCodes = allPermissions.map((permission) => permission.code);
  const excludedAiPermissionCodes = new Set(
    (await prisma.aiUserPermissionExclusion.findMany({
      select: { permission: { select: { code: true } } },
    })).map(({ permission }) => permission.code),
  );

  const roleDefinitions = [
    {
      code: 'super_admin',
      name: '超级管理员',
      permissions: allPermissionCodes,
    },
    {
      code: 'academic_admin',
      name: '教务管理员',
      permissions: allPermissionCodes.filter((code) => !['ai.provider.manage', 'ai.prompt.manage'].includes(code)),
    },
    {
      code: AI_USER_ROLE_CODE,
      name: AI_USER_ROLE_NAME,
      permissions: getAiUserSeedPermissionCodes(
        allPermissionCodes,
        excludedAiPermissionCodes,
      ),
    },
    {
      code: 'teacher',
      name: '教师',
      permissions: [
        'course:read',
        'knowledge-point:read',
        'tag:read',
        'question:read',
        'question:create',
        'question:update',
        'question:publish',
        'question:delete',
        'paper:read',
        'paper:create',
        'paper:update',
        'paper:publish',
        'exam:read',
        'exam:create',
        'exam:update',
        'exam:delete',
        'exam:publish',
        'exam:result:read',
        'exam:result:export',
        'class:read',
        'class:create',
        'class:update',
        'grading:read',
        'grading:update',
        'grading:score:read',
        'grading:score:update',
        'grading:rubric:update',
        'grading:regrade:preview',
        'grading:regrade:confirm',
        'exam:answer:read',
        'question:answer:read',
        'question:analysis:read',
        'student:identity:read',
        'export:task:create',
        'export:task:read',
        'export:file:download',
        'attachment:preview',
        'attachment:download',
        'hydro:problem:bind',
        'hydro:account:read',
        'hydro:account:update',
        'hydro:result:write',
        'statistics:read',
        'dashboard:read',
        'ai.summary.exam.generate',
        'ai.chat.use',
        'ai.chat.general-knowledge',
        'ai.data.question-bank',
        'ai.data.papers',
        'ai.data.classes',
        'ai.data.exams',
        'ai.answer.direct',
        'ai.data.grade-history',
        'ai.data.attendance',
        'ai.data.schedule',
        'ai.data.teacher-materials',
        'ai.data.lesson-plans',
        'ai.summary.student.generate',
        'ai.summary.class.generate',
        'ai.summary.parent-report.generate',
        'ai.summary.lesson.generate',
        'ai.summary.review',
        'ai.summary.publish',
        'ai.summary.revoke',
        'ai.summary.view-class',
        'ai.feedback.create',
        'ai.quality.read',
        'ai.quality.manage',
        'ai.provider.manage-own',
        'academic-profile:read',
        'lesson-type:read',
        'course-unit:read',
        'schedule:read',
        'schedule:manage',
        'attendance:read',
        'attendance:confirm',
        'attendance:correct',
        'lesson-hour:read',
        'lesson-record:read',
        'lesson-record:manage',
        'lesson-record:publish',
        'lesson-plan:read',
        'lesson-plan:manage',
        'lesson-asset:manage',
        'lesson-asset:download',
        'scratch-template:read',
        'scratch-template:manage',
        'scratch-assignment:read',
        'scratch-assignment:manage',
        'scratch-assignment:publish',
        'scratch-work:read',
        'scratch-work:review',
        'scratch-asset:download',
        'scratch-judge:manage',
      ],
    },
    {
      code: 'student',
      name: '学生',
      permissions: [
        'course:read', 'knowledge-point:read', 'tag:read', 'ai.chat.use', 'ai.chat.general-knowledge', 'ai.data.question-bank', 'ai.data.papers', 'ai.summary.view-own', 'ai.feedback.create', 'academic-profile:read', 'dashboard:read',
        'schedule:read', 'attendance:read', 'lesson-hour:read', 'lesson-record:read', 'lesson-asset:download',
        'scratch-assignment:read', 'scratch-work:read', 'scratch-work:save', 'scratch-work:submit', 'scratch-asset:download',
      ],
    },
    {
      code: 'parent',
      name: '家长',
      permissions: [
        'academic-profile:read', 'ai.chat.use', 'ai.chat.general-knowledge', 'ai.data.question-bank', 'ai.data.papers', 'ai.answer.direct', 'ai.summary.view-own', 'ai.feedback.create', 'dashboard:read', 'schedule:read', 'attendance:read', 'lesson-hour:read',
        'lesson-record:read', 'lesson-asset:download', 'scratch-assignment:read', 'scratch-work:read', 'scratch-asset:download',
      ],
    },
  ];

  for (const roleDefinition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { code: roleDefinition.code },
      update: { name: roleDefinition.name },
      create: {
        code: roleDefinition.code,
        name: roleDefinition.name,
      },
    });

    if (roleDefinition.code === AI_USER_ROLE_CODE) {
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: {
            in: allPermissions
              .filter(({ code }) =>
                !isAiReadablePermission(code) || excludedAiPermissionCodes.has(code))
              .map(({ id }) => id),
          },
        },
      });
    }

    for (const permissionCode of roleDefinition.permissions) {
      const permission = allPermissions.find((item) => item.code === permissionCode);

      if (!permission) {
        continue;
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }

  const passwordHash = await bcrypt.hash('123456', 10);
  const users = [
    {
      username: 'admin',
      realName: 'Admin User',
      userType: UserType.SUPER_ADMIN,
      roleCode: 'super_admin',
    },
    {
      username: 'teacher001',
      realName: 'Teacher One',
      userType: UserType.TEACHER,
      roleCode: 'teacher',
    },
    {
      username: 'student001',
      realName: 'Student One',
      userType: UserType.STUDENT,
      roleCode: 'student',
    },
  ];

  for (const item of users) {
    const user = await prisma.user.upsert({
      where: { username: item.username },
      update: {
        realName: item.realName,
        userType: item.userType,
        status: UserStatus.ACTIVE,
      },
      create: {
        username: item.username,
        passwordHash,
        realName: item.realName,
        userType: item.userType,
        status: UserStatus.ACTIVE,
      },
    });

    const role = await prisma.role.findUniqueOrThrow({
      where: { code: item.roleCode },
    });

    const exists = await prisma.userRole.findFirst({
      where: {
        userId: user.id,
        roleId: role.id,
        scopeType: 'GLOBAL',
      },
    });

    if (!exists) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          scopeType: 'GLOBAL',
        },
      });
    }
  }

  const reviewingAdmin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await prisma.aiSummaryPromptTemplate.updateMany({
    where: {
      code: { in: ['exam-summary', 'student-summary', 'class-summary', 'parent-report', 'lesson-assistant'] },
      version: { in: [1, 2] },
    },
    data: { enabled: true, reviewedBy: reviewingAdmin.id },
  });
  await prisma.aiSummaryPromptTemplate.updateMany({
    where: { code: { in: ['exam-summary', 'student-summary'] }, version: 1 },
    data: { enabled: false },
  });

  const course = await prisma.course.upsert({
    where: { code: 'python_basic' },
    update: {
      name: 'Python Basic',
      sortOrder: 1,
    },
    create: {
      name: 'Python Basic',
      code: 'python_basic',
      description: 'Introductory Python course.',
      sortOrder: 1,
    },
  });

  const root = await prisma.knowledgePoint.upsert({
    where: {
      courseId_code: {
        courseId: course.id,
        code: 'python_basic',
      },
    },
    update: {
      name: 'Python Basic',
      level: 1,
      sortOrder: 1,
    },
    create: {
      courseId: course.id,
      name: 'Python Basic',
      code: 'python_basic',
      level: 1,
      sortOrder: 1,
    },
  });

  const childPoints = [
    ['input_output', 'Input and Output'],
    ['variables', 'Variables'],
    ['conditions', 'Conditions'],
    ['loops', 'Loops'],
  ] as const;

  for (const [code, name] of childPoints) {
    await prisma.knowledgePoint.upsert({
      where: {
        courseId_code: {
          courseId: course.id,
          code,
        },
      },
      update: {
        name,
        parentId: root.id,
        level: 2,
      },
      create: {
        courseId: course.id,
        parentId: root.id,
        name,
        code,
        level: 2,
      },
    });
  }

  const tags = [
    ['intro', 'Intro'],
    ['error_prone', 'Error Prone'],
    ['class_practice', 'Class Practice'],
  ] as const;

  for (const [code, name] of tags) {
    await prisma.tag.upsert({
      where: { code },
      update: { name, type: TagType.QUESTION },
      create: {
        code,
        name,
        type: TagType.QUESTION,
      },
    });
  }

  const teacher = await prisma.user.findUniqueOrThrow({
    where: { username: 'teacher001' },
  });
  const student = await prisma.user.findUniqueOrThrow({
    where: { username: 'student001' },
  });
  await prisma.teacherProfile.upsert({ where: { userId: teacher.id }, update: {}, create: { userId: teacher.id } });
  await prisma.studentProfile.upsert({ where: { userId: student.id }, update: {}, create: { userId: student.id } });
  const defaultClass = await prisma.classGroup.upsert({
    where: { code: 'python_basic_demo_class' },
    update: {
      name: 'Python Basic Demo Class',
      courseId: course.id,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      name: 'Python Basic Demo Class',
      code: 'python_basic_demo_class',
      courseId: course.id,
      description: 'Default local class for exam scope testing.',
      status: 'active',
      sortOrder: 1,
      createdBy: teacher.id,
      updatedBy: teacher.id,
    },
  });
  await prisma.classTeacher.upsert({
    where: {
      classId_teacherId: {
        classId: defaultClass.id,
        teacherId: teacher.id,
      },
    },
    update: { status: ClassMemberStatus.ACTIVE, leftAt: null },
    create: {
      classId: defaultClass.id,
      teacherId: teacher.id,
    },
  });
  await prisma.classStudent.upsert({
    where: {
      classId_studentId: {
        classId: defaultClass.id,
        studentId: student.id,
      },
    },
    update: { status: ClassMemberStatus.ACTIVE, leftAt: null },
    create: {
      classId: defaultClass.id,
      studentId: student.id,
    },
  });
  const variablePoint = await prisma.knowledgePoint.findFirstOrThrow({
    where: { courseId: course.id, code: 'variables' },
  });
  const loopPoint = await prisma.knowledgePoint.findFirstOrThrow({
    where: { courseId: course.id, code: 'loops' },
  });
  const introTag = await prisma.tag.findUniqueOrThrow({ where: { code: 'intro' } });

  const sampleQuestions = [
    {
      title: 'Python output function',
      content: 'Which function is used to output text in Python?',
      type: QuestionType.SINGLE_CHOICE,
      difficulty: 1,
      defaultScore: 2,
      analysis: 'print is the built-in function for output.',
      knowledgePointId: variablePoint.id,
      options: [
        ['A', 'input()', false],
        ['B', 'print()', true],
        ['C', 'len()', false],
        ['D', 'range()', false],
      ] as const,
    },
    {
      title: 'Python loop keyword',
      content: 'Which keyword can be used to create a loop in Python?',
      type: QuestionType.SINGLE_CHOICE,
      difficulty: 1,
      defaultScore: 2,
      analysis: 'for can iterate through a sequence.',
      knowledgePointId: loopPoint.id,
      options: [
        ['A', 'for', true],
        ['B', 'print', false],
        ['C', 'return', false],
        ['D', 'import', false],
      ] as const,
    },
    {
      title: 'Python mutable containers',
      content: 'Which of the following are common mutable containers in Python?',
      type: QuestionType.MULTIPLE_CHOICE,
      difficulty: 2,
      defaultScore: 4,
      analysis: 'Lists and dictionaries are mutable containers.',
      knowledgePointId: variablePoint.id,
      options: [
        ['A', 'list', true],
        ['B', 'dict', true],
        ['C', 'int', false],
        ['D', 'str', false],
      ] as const,
    },
  ];

  const createdQuestionIds: string[] = [];
  for (const item of sampleQuestions) {
    let question = await prisma.question.findFirst({
      where: { title: item.title, courseId: course.id, deletedAt: null },
    });

    if (!question) {
      question = await prisma.question.create({
        data: {
          courseId: course.id,
          type: item.type,
          title: item.title,
          content: item.content,
          difficulty: item.difficulty,
          defaultScore: item.defaultScore,
          analysis: item.analysis,
          status: QuestionStatus.PUBLISHED,
          createdBy: teacher.id,
          updatedBy: teacher.id,
          reviewedBy: teacher.id,
          reviewedAt: new Date(),
        },
      });

      const options: Array<{ id: string; isCorrect: boolean }> = [];
      for (const [index, option] of item.options.entries()) {
        options.push(
          await prisma.questionOption.create({
            data: {
              questionId: question.id,
              optionKey: option[0],
              content: option[1],
              isCorrect: option[2],
              sortOrder: index + 1,
            },
          }),
        );
      }

      await prisma.questionAnswer.create({
        data: {
          questionId: question.id,
          answerJson: {
            correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id),
          },
          scoringRuleJson: { mode: 'strict' },
        },
      });

      await prisma.questionKnowledgePoint.create({
        data: {
          questionId: question.id,
          knowledgePointId: item.knowledgePointId,
        },
      });
      await prisma.questionTag.create({
        data: {
          questionId: question.id,
          tagId: introTag.id,
        },
      });
    }

    const fullQuestion = await prisma.question.findUniqueOrThrow({
      where: { id: question.id },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        knowledgePoints: { include: { knowledgePoint: true } },
        tags: { include: { tag: true } },
      },
    });
    const snapshot = {
      id: fullQuestion.id,
      courseId: fullQuestion.courseId,
      courseName: fullQuestion.course.name,
      type: fullQuestion.type.toLowerCase(),
      title: fullQuestion.title,
      content: fullQuestion.content,
      difficulty: fullQuestion.difficulty,
      defaultScore: Number(fullQuestion.defaultScore),
      analysis: fullQuestion.analysis,
      allowOptionShuffle: fullQuestion.allowOptionShuffle,
      version: fullQuestion.version,
      options: fullQuestion.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
        sortOrder: option.sortOrder,
      })),
      answer: fullQuestion.answer?.answerJson ?? null,
      scoringRule: fullQuestion.answer?.scoringRuleJson ?? null,
      knowledgePoints: fullQuestion.knowledgePoints.map((relation) => ({
        id: relation.knowledgePoint.id,
        name: relation.knowledgePoint.name,
      })),
      tags: fullQuestion.tags.map((relation) => ({
        id: relation.tag.id,
        name: relation.tag.name,
      })),
    };

    const versionExists = await prisma.questionVersion.findFirst({
      where: { questionId: question.id, version: fullQuestion.version },
    });
    if (!versionExists) {
      await prisma.questionVersion.create({
        data: {
          questionId: question.id,
          version: fullQuestion.version,
          snapshotJson: snapshot,
          createdBy: teacher.id,
        },
      });
    }

    createdQuestionIds.push(question.id);
  }

  let paper = await prisma.paper.findFirst({
    where: { name: 'Python MVP Demo Paper', courseId: course.id, deletedAt: null },
  });

  if (!paper) {
    paper = await prisma.paper.create({
      data: {
        name: 'Python MVP Demo Paper',
        courseId: course.id,
        durationMinutes: 30,
        type: PaperType.FIXED,
        status: PaperStatus.PUBLISHED,
        totalScore: 8,
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });

    const section = await prisma.paperSection.create({
      data: {
        paperId: paper.id,
        title: 'Objective Questions',
        description: 'Auto graded questions',
        sortOrder: 1,
        score: 8,
      },
    });

    for (const [index, questionId] of createdQuestionIds.entries()) {
      const question = await prisma.question.findUniqueOrThrow({
        where: { id: questionId },
        include: {
          course: true,
          options: { orderBy: { sortOrder: 'asc' } },
          answer: true,
          knowledgePoints: { include: { knowledgePoint: true } },
          tags: { include: { tag: true } },
        },
      });
      const snapshot = {
        id: question.id,
        courseId: question.courseId,
        courseName: question.course.name,
        type: question.type.toLowerCase(),
        title: question.title,
        content: question.content,
        difficulty: question.difficulty,
        defaultScore: Number(question.defaultScore),
        analysis: question.analysis,
        allowOptionShuffle: question.allowOptionShuffle,
        version: question.version,
        options: question.options.map((option) => ({
          id: option.id,
          optionKey: option.optionKey,
          content: option.content,
          isCorrect: option.isCorrect,
          sortOrder: option.sortOrder,
        })),
        answer: question.answer?.answerJson ?? null,
        scoringRule: question.answer?.scoringRuleJson ?? null,
        knowledgePoints: question.knowledgePoints.map((relation) => ({
          id: relation.knowledgePoint.id,
          name: relation.knowledgePoint.name,
        })),
        tags: question.tags.map((relation) => ({
          id: relation.tag.id,
          name: relation.tag.name,
        })),
      };
      await prisma.paperQuestion.create({
        data: {
          paperId: paper.id,
          sectionId: section.id,
          questionId,
          questionSnapshotJson: snapshot,
          score: Number(question.defaultScore),
          sortOrder: index + 1,
        },
      });
    }
  }

  const exam = await prisma.exam.findFirst({
    where: { name: 'Python MVP Demo Exam', courseId: course.id, deletedAt: null },
  });

  if (!exam) {
    const now = new Date();
    await prisma.exam.create({
      data: {
        paperId: paper.id,
        name: 'Python MVP Demo Exam',
        courseId: course.id,
        startTime: new Date(now.getTime() - 60 * 60 * 1000),
        endTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        durationMinutes: 30,
        attemptLimit: 1,
        showAnswerMode: 'AFTER_SUBMIT',
        showScoreMode: 'AFTER_SUBMIT',
        status: 'RUNNING',
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
