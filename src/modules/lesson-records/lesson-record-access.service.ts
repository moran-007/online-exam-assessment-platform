import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassMemberStatus, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LessonRecordAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  isInternal(actor: RequestUser) {
    return hasPermission(actor, 'lesson-record:manage');
  }

  async session(sessionId: string, actor: RequestUser, requestedStudentId?: string) {
    const session = await this.prisma.lessonSession.findUnique({
      where: { id: sessionId },
      include: {
        classGroup: { select: { id: true, name: true, course: { select: { id: true, name: true } } } },
        teacher: { select: { id: true, realName: true, username: true } },
        lessonType: { select: { id: true, name: true } },
        unitTemplate: { select: { id: true, name: true } },
        knowledgePoint: { select: { id: true, name: true } },
      },
    });
    if (!session) throw new NotFoundException('课次不存在');

    if (this.isInternal(actor)) {
      await this.dataScope.assertAcademicClassAccessible(actor, session.classId);
      return { session, learnerId: null, internal: true };
    }

    const learnerId = await this.learnerId(actor, requestedStudentId);
    const membership = await this.prisma.classStudent.findFirst({
      where: {
        classId: session.classId,
        studentId: learnerId,
        status: ClassMemberStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('该学生不属于此课次班级');
    return { session, learnerId, internal: false };
  }

  async learnerId(actor: RequestUser, requestedStudentId?: string) {
    if (actor.userType === UserType.STUDENT) {
      if (requestedStudentId && requestedStudentId !== actor.id) {
        throw new ForbiddenException('学生只能查看本人学习数据');
      }
      return actor.id;
    }
    if (actor.userType === UserType.PARENT) {
      if (!requestedStudentId) throw new ForbiddenException('家长查看学习数据时必须指定已关联学生');
      await this.dataScope.assertStudentAccessible(actor, requestedStudentId);
      return requestedStudentId;
    }
    if (!requestedStudentId) throw new ForbiddenException('请指定学生');
    await this.dataScope.assertStudentAccessible(actor, requestedStudentId);
    return requestedStudentId;
  }
}
