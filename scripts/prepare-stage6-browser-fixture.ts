import { ClassTeacherRole, PrismaClient, UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);
  const [teacher, student, parent, unrelatedParent, parentRole] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: 'teacher001' } }),
    prisma.user.findUniqueOrThrow({ where: { username: 'student001' } }),
    prisma.user.upsert({
      where: { username: 'stage6_parent' },
      update: { passwordHash, status: UserStatus.ACTIVE, deletedAt: null },
      create: { username: 'stage6_parent', realName: 'Stage 6 家长', passwordHash, userType: UserType.PARENT },
    }),
    prisma.user.upsert({
      where: { username: 'stage6_unrelated_parent' },
      update: { passwordHash, status: UserStatus.ACTIVE, deletedAt: null },
      create: { username: 'stage6_unrelated_parent', realName: '未关联家长', passwordHash, userType: UserType.PARENT },
    }),
    prisma.role.findUniqueOrThrow({ where: { code: 'parent' } }),
  ]);
  await prisma.user.updateMany({
    where: { id: { in: [teacher.id, student.id] } },
    data: { passwordHash, status: UserStatus.ACTIVE, deletedAt: null },
  });
  await prisma.userRole.createMany({
    data: [parent, unrelatedParent].map((user) => ({ userId: user.id, roleId: parentRole.id })),
    skipDuplicates: true,
  });

  const classGroup = await prisma.classGroup.upsert({
    where: { code: 'stage6-browser-class' },
    update: { name: 'Stage 6 浏览器验收班', status: 'active', deletedAt: null },
    create: { code: 'stage6-browser-class', name: 'Stage 6 浏览器验收班' },
  });
  await prisma.classTeacher.upsert({
    where: { classId_teacherId: { classId: classGroup.id, teacherId: teacher.id } },
    update: { status: 'ACTIVE', role: ClassTeacherRole.LEAD, leftAt: null },
    create: { classId: classGroup.id, teacherId: teacher.id, role: ClassTeacherRole.LEAD },
  });
  await prisma.classStudent.upsert({
    where: { classId_studentId: { classId: classGroup.id, studentId: student.id } },
    update: { status: 'ACTIVE', leftAt: null },
    create: { classId: classGroup.id, studentId: student.id },
  });
  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
    update: { status: 'ACTIVE', relationship: '监护人', isPrimary: true, unlinkedAt: null },
    create: { parentId: parent.id, studentId: student.id, relationship: '监护人', isPrimary: true },
  });

  const lessonType = await prisma.lessonType.upsert({
    where: { name: 'Stage 6 浏览测试课' },
    update: { active: true },
    create: { name: 'Stage 6 浏览测试课', defaultHours: 1, createdBy: teacher.id, updatedBy: teacher.id },
  });
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 1);
  startsAt.setHours(18, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const session = await prisma.lessonSession.upsert({
    where: { generationKey: 'stage6-browser-session' },
    update: {
      classId: classGroup.id,
      teacherId: teacher.id,
      lessonTypeId: lessonType.id,
      startsAt,
      endsAt,
      title: 'Stage 6 教学记录点击验收',
      status: 'PLANNED',
      updatedBy: teacher.id,
    },
    create: {
      classId: classGroup.id,
      teacherId: teacher.id,
      lessonTypeId: lessonType.id,
      generationKey: 'stage6-browser-session',
      title: 'Stage 6 教学记录点击验收',
      startsAt,
      endsAt,
      createdBy: teacher.id,
      updatedBy: teacher.id,
    },
  });
  console.log(JSON.stringify({ classId: classGroup.id, sessionId: session.id, studentId: student.id }));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

