import {
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

const prisma = new PrismaClient();

const permissions = [
  ['course:read', 'Read courses'],
  ['course:create', 'Create courses'],
  ['course:update', 'Update courses'],
  ['knowledge-point:read', 'Read knowledge points'],
  ['knowledge-point:create', 'Create knowledge points'],
  ['knowledge-point:update', 'Update knowledge points'],
  ['tag:read', 'Read tags'],
  ['tag:create', 'Create tags'],
  ['tag:update', 'Update tags'],
  ['question:read', 'Read questions'],
  ['question:create', 'Create questions'],
  ['question:update', 'Update questions'],
  ['paper:read', 'Read papers'],
  ['paper:create', 'Create papers'],
  ['paper:publish', 'Publish papers'],
  ['exam:read', 'Read exams'],
  ['exam:create', 'Create exams'],
  ['exam:publish', 'Publish exams'],
  ['exam:result:read', 'Read exam results'],
  ['exam:result:export', 'Export exam results'],
  ['class:read', 'Read classes'],
  ['class:create', 'Create classes'],
  ['class:update', 'Update classes'],
  ['grading:read', 'Read grading tasks'],
  ['grading:update', 'Update grading tasks'],
  ['statistics:read', 'Read statistics'],
  ['audit-log:read', 'Read audit logs'],
] as const;

async function main() {
  for (const [code, name] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: {
        code,
        name,
        type: PermissionType.API,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const allPermissionCodes = allPermissions.map((permission) => permission.code);

  const roleDefinitions = [
    {
      code: 'super_admin',
      name: 'Super Admin',
      permissions: allPermissionCodes,
    },
    {
      code: 'teacher',
      name: 'Teacher',
      permissions: [
        'course:read',
        'knowledge-point:read',
        'tag:read',
        'question:read',
        'question:create',
        'question:update',
        'paper:read',
        'paper:create',
        'paper:publish',
        'exam:read',
        'exam:create',
        'exam:publish',
        'exam:result:read',
        'exam:result:export',
        'class:read',
        'class:create',
        'class:update',
        'grading:read',
        'grading:update',
        'statistics:read',
      ],
    },
    {
      code: 'student',
      name: 'Student',
      permissions: ['course:read', 'knowledge-point:read', 'tag:read'],
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
    update: {},
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
    update: {},
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
