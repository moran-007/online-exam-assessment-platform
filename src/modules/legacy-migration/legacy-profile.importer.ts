import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ClassMemberStatus,
  ClassTeacherRole,
  Prisma,
  UserStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyProfileSnapshotDto } from './dto/legacy-profile-snapshot.dto';
import {
  accountUsername,
  classCode,
  normalizePhone,
  parentLegacyId,
  usernameFor,
} from './legacy-migration.helpers';

type ResolutionPolicy = { skip: Set<string>; withoutPhone: Set<string> };

@Injectable()
export class LegacyProfileImporter {
  constructor(private readonly prisma: PrismaService) {}

  async apply(runId: string, snapshot: LegacyProfileSnapshotDto) {
    const policies = await this.resolutionPolicies(runId);
    const roleIds = await this.roleIds();
    await this.prisma.$transaction(async (tx) => {
      const targets = await this.loadTargets(tx, snapshot.sourceSystem);
      await this.importStudents(tx, runId, snapshot, policies, roleIds.student, targets);
      await this.importTeachers(tx, runId, snapshot, policies, roleIds.teacher, targets);
      await this.importParents(tx, runId, snapshot, policies, roleIds.parent, targets);
      await this.importClasses(tx, runId, snapshot, policies, targets);
      await this.importMemberships(tx, runId, snapshot, policies, targets);
    }, { timeout: 120_000 });

    return this.prisma.legacyIdMapping.count({ where: { sourceSystem: snapshot.sourceSystem } });
  }

  private async importStudents(
    tx: Prisma.TransactionClient,
    runId: string,
    snapshot: LegacyProfileSnapshotDto,
    policies: ResolutionPolicy,
    roleId: string,
    targets: Map<string, string>,
  ) {
    for (const item of snapshot.students) {
      const key = this.key('student', item.legacyId);
      if (policies.skip.has(key)) continue;
      let userId = targets.get(key);
      if (!userId) {
        const user = await tx.user.create({
          data: {
            username: accountUsername(snapshot, 'student', item.legacyId),
            realName: item.name,
            phone: policies.withoutPhone.has(key) ? null : normalizePhone(item.phone),
            passwordHash: await this.randomPasswordHash(),
            userType: UserType.STUDENT,
            status: UserStatus.PENDING_ACTIVATION,
            mustChangePassword: true,
            studentProfile: {
              create: {
                gender: item.gender,
                school: item.school,
                enrollmentStatus: this.activeStatus(item.status),
              },
            },
            roles: { create: { roleId, scopeType: 'GLOBAL' } },
          },
          select: { id: true },
        });
        userId = user.id;
        await this.createMapping(tx, runId, snapshot.sourceSystem, 'student', item.legacyId, userId);
        targets.set(key, userId);
      }
    }
  }

  private async importTeachers(
    tx: Prisma.TransactionClient,
    runId: string,
    snapshot: LegacyProfileSnapshotDto,
    policies: ResolutionPolicy,
    roleId: string,
    targets: Map<string, string>,
  ) {
    for (const item of snapshot.teachers) {
      const key = this.key('teacher', item.legacyId);
      if (policies.skip.has(key)) continue;
      let userId = targets.get(key);
      if (!userId) {
        const user = await tx.user.create({
          data: {
            username: accountUsername(snapshot, 'teacher', item.legacyId),
            realName: item.name,
            phone: policies.withoutPhone.has(key) ? null : normalizePhone(item.phone),
            passwordHash: await this.randomPasswordHash(),
            userType: UserType.TEACHER,
            status: UserStatus.PENDING_ACTIVATION,
            mustChangePassword: true,
            teacherProfile: {
              create: { subject: item.subject, employmentStatus: this.activeStatus(item.status) },
            },
            roles: { create: { roleId, scopeType: 'GLOBAL' } },
          },
          select: { id: true },
        });
        userId = user.id;
        await this.createMapping(tx, runId, snapshot.sourceSystem, 'teacher', item.legacyId, userId);
        targets.set(key, userId);
      }
    }
  }

  private async importParents(
    tx: Prisma.TransactionClient,
    runId: string,
    snapshot: LegacyProfileSnapshotDto,
    policies: ResolutionPolicy,
    roleId: string,
    targets: Map<string, string>,
  ) {
    const parents = new Map<string, { name?: string; studentIds: string[] }>();
    for (const item of snapshot.students) {
      const phone = normalizePhone(item.parentPhone);
      if (!phone || policies.skip.has(`parent-link:${item.legacyId}`)) continue;
      const current = parents.get(phone) ?? { studentIds: [] };
      current.name ||= item.parentName;
      current.studentIds.push(item.legacyId);
      parents.set(phone, current);
    }

    for (const [phone, item] of parents) {
      const legacyId = parentLegacyId(phone);
      const key = this.key('parent', legacyId);
      if (policies.skip.has(key)) continue;
      let parentId = targets.get(key);
      if (!parentId) {
        const parent = await tx.user.create({
          data: {
            username: usernameFor('parent', legacyId),
            realName: item.name,
            phone: policies.withoutPhone.has(key) ? null : phone,
            passwordHash: await this.randomPasswordHash(),
            userType: UserType.PARENT,
            status: UserStatus.PENDING_ACTIVATION,
            mustChangePassword: true,
            roles: { create: { roleId, scopeType: 'GLOBAL' } },
          },
          select: { id: true },
        });
        parentId = parent.id;
        await this.createMapping(tx, runId, snapshot.sourceSystem, 'parent', legacyId, parentId);
        targets.set(key, parentId);
      }
      for (const studentLegacyId of item.studentIds) {
        const studentId = targets.get(this.key('student', studentLegacyId));
        if (!studentId) continue;
        await tx.parentStudent.upsert({
          where: { parentId_studentId: { parentId, studentId } },
          update: { status: ClassMemberStatus.ACTIVE, unlinkedAt: null },
          create: { parentId, studentId, relationship: '监护人' },
        });
      }
    }
  }

  private async importClasses(
    tx: Prisma.TransactionClient,
    runId: string,
    snapshot: LegacyProfileSnapshotDto,
    policies: ResolutionPolicy,
    targets: Map<string, string>,
  ) {
    for (const item of snapshot.classes) {
      const key = this.key('class', item.legacyId);
      if (policies.skip.has(key)) continue;
      let classId = targets.get(key);
      if (!classId) {
        const classGroup = await tx.classGroup.create({
          data: {
            name: item.name,
            code: classCode(item.legacyId),
            status: this.activeStatus(item.status),
            description: `迁移自 ${snapshot.sourceSystem}`,
          },
          select: { id: true },
        });
        classId = classGroup.id;
        await this.createMapping(tx, runId, snapshot.sourceSystem, 'class', item.legacyId, classId);
        targets.set(key, classId);
      }
      const teacherId = item.teacherLegacyId
        ? targets.get(this.key('teacher', item.teacherLegacyId))
        : undefined;
      if (teacherId) {
        const relation = await tx.classTeacher.upsert({
          where: { classId_teacherId: { classId, teacherId } },
          update: { status: ClassMemberStatus.ACTIVE, role: ClassTeacherRole.LEAD, leftAt: null },
          create: {
            classId,
            teacherId,
            role: ClassTeacherRole.LEAD,
            sourceSystem: snapshot.sourceSystem,
          },
          select: { id: true },
        });
        const relationLegacyId = `${item.legacyId}:${item.teacherLegacyId}`;
        const relationKey = this.key('class_teacher', relationLegacyId);
        if (!targets.has(relationKey)) {
          await this.createMapping(
            tx,
            runId,
            snapshot.sourceSystem,
            'class_teacher',
            relationLegacyId,
            relation.id,
          );
          targets.set(relationKey, relation.id);
        }
      }
    }
  }

  private async importMemberships(
    tx: Prisma.TransactionClient,
    runId: string,
    snapshot: LegacyProfileSnapshotDto,
    policies: ResolutionPolicy,
    targets: Map<string, string>,
  ) {
    for (const item of snapshot.classStudents) {
      const key = this.key('class_student', item.legacyId);
      if (policies.skip.has(key)) continue;
      const classId = targets.get(this.key('class', item.classLegacyId));
      const studentId = targets.get(this.key('student', item.studentLegacyId));
      if (!classId || !studentId) continue;
      const active = this.activeStatus(item.status) === 'active';
      const relation = await tx.classStudent.upsert({
        where: { classId_studentId: { classId, studentId } },
        update: {
          status: active ? ClassMemberStatus.ACTIVE : ClassMemberStatus.LEFT,
          leftAt: active ? null : this.safeDate(item.leaveDate),
          sourceSystem: snapshot.sourceSystem,
        },
        create: {
          classId,
          studentId,
          status: active ? ClassMemberStatus.ACTIVE : ClassMemberStatus.LEFT,
          joinedAt: this.safeDate(item.joinDate) ?? new Date(),
          leftAt: active ? null : this.safeDate(item.leaveDate),
          sourceSystem: snapshot.sourceSystem,
        },
        select: { id: true },
      });
      if (!targets.has(key)) {
        await this.createMapping(tx, runId, snapshot.sourceSystem, 'class_student', item.legacyId, relation.id);
        targets.set(key, relation.id);
      }
    }
  }

  private async resolutionPolicies(runId: string): Promise<ResolutionPolicy> {
    const conflicts = await this.prisma.migrationConflict.findMany({ where: { runId } });
    const policy: ResolutionPolicy = { skip: new Set(), withoutPhone: new Set() };
    for (const conflict of conflicts) {
      if (!conflict.resolution) continue;
      const resolution = JSON.parse(conflict.resolution) as { code: string };
      const summary = conflict.summary as { affectedKeys?: string[] };
      const target = resolution.code === 'SKIP' ? policy.skip : policy.withoutPhone;
      for (const key of summary.affectedKeys ?? []) target.add(key);
    }
    return policy;
  }

  private async roleIds() {
    const roles = await this.prisma.role.findMany({ where: { code: { in: ['student', 'teacher', 'parent'] } } });
    const student = roles.find((role) => role.code === 'student')?.id;
    const teacher = roles.find((role) => role.code === 'teacher')?.id;
    const parent = roles.find((role) => role.code === 'parent')?.id;
    if (!student || !teacher || !parent) throw new BadRequestException('缺少 student、teacher 或 parent 基础角色');
    return { student, teacher, parent };
  }

  private async loadTargets(tx: Prisma.TransactionClient, sourceSystem: string) {
    const mappings = await tx.legacyIdMapping.findMany({ where: { sourceSystem } });
    return new Map(mappings.map((item) => [this.key(item.entityType, item.legacyId), item.targetId]));
  }

  private createMapping(
    tx: Prisma.TransactionClient,
    runId: string,
    sourceSystem: string,
    entityType: string,
    legacyId: string,
    targetId: string,
  ) {
    return tx.legacyIdMapping.create({ data: { runId, sourceSystem, entityType, legacyId, targetId } });
  }

  private key(type: string, legacyId: string) {
    return `${type}:${legacyId}`;
  }

  private activeStatus(status?: string) {
    return !status || status.toLowerCase() === 'active' ? 'active' : 'inactive';
  }

  private safeDate(value?: string) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private async randomPasswordHash() {
    return bcrypt.hash(randomBytes(48).toString('base64url'), 10);
  }
}
