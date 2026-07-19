import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassMemberStatus, ScratchAssignmentStatus, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScratchAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  isInternal(actor: RequestUser) {
    return hasPermission(actor, 'scratch-assignment:manage') || hasPermission(actor, 'scratch-work:review');
  }

  async session(sessionId: string, actor: RequestUser) {
    const session = await this.prisma.lessonSession.findUnique({
      where: { id: sessionId },
      include: {
        classGroup: { select: { id: true, name: true } },
        teacher: { select: { id: true, username: true, realName: true } },
      },
    });
    if (!session) throw new NotFoundException('课次不存在');
    await this.dataScope.assertAcademicClassAccessible(actor, session.classId);
    return session;
  }

  async assignment(assignmentId: string, actor: RequestUser, requestedStudentId?: string) {
    const assignment = await this.prisma.lessonScratchAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        session: { include: { classGroup: { select: { id: true, name: true } } } },
        template: { include: { projectAsset: true, thumbnailAsset: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Scratch 任务不存在');
    if (this.isInternal(actor)) {
      await this.dataScope.assertAcademicClassAccessible(actor, assignment.session.classId);
      return { assignment, learnerId: null, internal: true };
    }
    if (assignment.status !== ScratchAssignmentStatus.PUBLISHED) throw new ForbiddenException('Scratch 任务尚未发布');
    const learnerId = await this.learnerId(actor, requestedStudentId);
    await this.assertStudentInClass(assignment.session.classId, learnerId);
    return { assignment, learnerId, internal: false };
  }

  async work(workId: string, actor: RequestUser) {
    const work = await this.prisma.scratchWork.findUnique({
      where: { id: workId },
      include: {
        student: { select: { id: true, username: true, realName: true } },
        assignment: { include: { session: true, template: true } },
      },
    });
    if (!work) throw new NotFoundException('Scratch 作品不存在');
    if (this.isInternal(actor)) {
      await this.dataScope.assertAcademicClassAccessible(actor, work.assignment.session.classId);
      return { work, internal: true };
    }
    if (actor.userType === UserType.STUDENT && actor.id !== work.studentId) {
      throw new ForbiddenException('学生只能访问本人 Scratch 作品');
    }
    if (actor.userType === UserType.PARENT) {
      await this.dataScope.assertStudentAccessible(actor, work.studentId);
    } else if (actor.userType !== UserType.STUDENT) {
      throw new ForbiddenException('无权访问该 Scratch 作品');
    }
    if (work.assignment.status !== ScratchAssignmentStatus.PUBLISHED) throw new ForbiddenException('Scratch 任务尚未发布');
    return { work, internal: false };
  }

  async learnerId(actor: RequestUser, requestedStudentId?: string) {
    if (actor.userType === UserType.STUDENT) {
      if (requestedStudentId && requestedStudentId !== actor.id) throw new ForbiddenException('学生只能访问本人数据');
      return actor.id;
    }
    if (actor.userType === UserType.PARENT) {
      if (!requestedStudentId) throw new ForbiddenException('家长必须指定已关联学生');
      await this.dataScope.assertStudentAccessible(actor, requestedStudentId);
      return requestedStudentId;
    }
    if (!requestedStudentId) throw new ForbiddenException('请指定学生');
    await this.dataScope.assertStudentAccessible(actor, requestedStudentId);
    return requestedStudentId;
  }

  async assertStudentInClass(classId: string, studentId: string) {
    const membership = await this.prisma.classStudent.findFirst({
      where: { classId, studentId, status: ClassMemberStatus.ACTIVE },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('学生不属于该 Scratch 任务班级');
  }
}
