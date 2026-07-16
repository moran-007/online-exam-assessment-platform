import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MigrationConflictStatus, MigrationRunStatus } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyProfileSnapshotDto, ResolveMigrationConflictDto } from './dto/legacy-profile-snapshot.dto';
import { fingerprintSnapshot, normalizePhone } from './legacy-migration.helpers';
import { LegacyMigrationPlanner } from './legacy-migration.planner';
import { LegacyProfileImporter } from './legacy-profile.importer';

@Injectable()
export class LegacyMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: LegacyMigrationPlanner,
    private readonly importer: LegacyProfileImporter,
    private readonly audit: AuditService,
  ) {}

  async preflight(snapshot: LegacyProfileSnapshotDto, actor: RequestUser) {
    const fingerprint = fingerprintSnapshot(snapshot);
    const prior = await this.prisma.migrationRun.findFirst({
      where: { sourceSystem: snapshot.sourceSystem, inputFingerprint: fingerprint },
      orderBy: { createdAt: 'desc' },
    });
    if (prior) return this.detail(prior.id);

    const [users, classes, mappings] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        select: { username: true, phone: true },
      }),
      this.prisma.classGroup.findMany({ where: { deletedAt: null }, select: { code: true } }),
      this.prisma.legacyIdMapping.findMany({
        where: { sourceSystem: snapshot.sourceSystem },
        select: { entityType: true, legacyId: true },
      }),
    ]);
    const conflicts = this.planner.buildConflicts(snapshot, {
      usernames: new Set(users.map((user) => user.username.toLowerCase())),
      phones: new Set(users.map((user) => normalizePhone(user.phone ?? undefined)).filter((item): item is string => Boolean(item))),
      classCodes: new Set(classes.map((item) => item.code)),
      mappedKeys: new Set(mappings.map((item) => `${item.entityType}:${item.legacyId}`)),
    });
    const run = await this.prisma.migrationRun.create({
      data: {
        sourceSystem: snapshot.sourceSystem,
        sourceVersion: snapshot.sourceVersion,
        inputFingerprint: fingerprint,
        status: conflicts.length ? MigrationRunStatus.PREFLIGHT_BLOCKED : MigrationRunStatus.READY,
        summary: this.planner.summary(snapshot),
        conflictCount: conflicts.length,
        createdBy: actor.id,
        conflicts: {
          create: conflicts.map((item) => ({
            conflictKey: item.key,
            entityType: item.entityType,
            legacyId: item.legacyId,
            conflictType: item.type,
            summary: { message: item.message, affectedKeys: item.affectedKeys },
          })),
        },
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'migration:preflight',
      module: 'legacy-migration',
      targetType: 'migration-run',
      targetId: run.id,
      afterData: { sourceSystem: snapshot.sourceSystem, conflictCount: conflicts.length },
    });
    return this.detail(run.id);
  }

  list() {
    return this.prisma.migrationRun.findMany({
      select: {
        id: true,
        sourceSystem: true,
        sourceVersion: true,
        status: true,
        summary: true,
        conflictCount: true,
        mappingCount: true,
        approvedAt: true,
        finishedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async detail(id: string) {
    const run = await this.prisma.migrationRun.findUnique({
      where: { id },
      include: { conflicts: { orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!run) throw new NotFoundException('迁移演练不存在');
    return run;
  }

  async resolveConflict(id: string, dto: ResolveMigrationConflictDto, actor: RequestUser) {
    const conflict = await this.prisma.migrationConflict.findUnique({ where: { id }, include: { run: true } });
    if (!conflict) throw new NotFoundException('迁移冲突不存在');
    if (
      conflict.run.status !== MigrationRunStatus.PREFLIGHT_BLOCKED &&
      conflict.run.status !== MigrationRunStatus.READY
    ) {
      throw new BadRequestException('当前迁移状态不允许修改冲突');
    }
    if (dto.resolutionCode === 'CREATE_WITHOUT_PHONE' && !conflict.conflictType.includes('PHONE')) {
      throw new BadRequestException('只有手机号冲突可选择无手机号建档');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.migrationConflict.update({
        where: { id },
        data: {
          status: dto.waive ? MigrationConflictStatus.WAIVED : MigrationConflictStatus.RESOLVED,
          resolution: JSON.stringify({ code: dto.resolutionCode, note: dto.note }),
          resolvedBy: actor.id,
          resolvedAt: new Date(),
        },
      });
      const open = await tx.migrationConflict.count({
        where: { runId: conflict.runId, status: MigrationConflictStatus.OPEN },
      });
      await tx.migrationRun.update({
        where: { id: conflict.runId },
        data: { status: open ? MigrationRunStatus.PREFLIGHT_BLOCKED : MigrationRunStatus.READY },
      });
    });
    return this.detail(conflict.runId);
  }

  async approve(id: string, actor: RequestUser) {
    const run = await this.detail(id);
    const open = run.conflicts.filter((item) => item.status === MigrationConflictStatus.OPEN).length;
    if (open) throw new BadRequestException(`仍有 ${open} 项冲突未处置`);
    if (run.status !== MigrationRunStatus.READY) throw new BadRequestException('当前迁移状态不可批准');
    await this.prisma.migrationRun.update({
      where: { id },
      data: { status: MigrationRunStatus.APPROVED, approvedBy: actor.id, approvedAt: new Date() },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'migration:approve',
      module: 'legacy-migration',
      targetType: 'migration-run',
      targetId: id,
    });
    return this.detail(id);
  }

  async apply(id: string, snapshot: LegacyProfileSnapshotDto, actor: RequestUser) {
    const run = await this.prisma.migrationRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('迁移演练不存在');
    if (run.inputFingerprint !== fingerprintSnapshot(snapshot)) throw new BadRequestException('迁移输入与预检指纹不一致');
    if (run.status === MigrationRunStatus.COMPLETED) return this.detail(id);
    if (run.status !== MigrationRunStatus.APPROVED) throw new BadRequestException('迁移必须先完成冲突处置并批准');
    await this.prisma.migrationRun.update({
      where: { id },
      data: { status: MigrationRunStatus.APPLYING, startedAt: new Date(), failureMessage: null },
    });
    try {
      const mappingCount = await this.importer.apply(id, snapshot);
      await this.prisma.migrationRun.update({
        where: { id },
        data: { status: MigrationRunStatus.COMPLETED, mappingCount, finishedAt: new Date() },
      });
      await this.audit.log({
        userId: actor.id,
        action: 'migration:apply',
        module: 'legacy-migration',
        targetType: 'migration-run',
        targetId: id,
        afterData: { mappingCount },
      });
      return this.detail(id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : '未知迁移错误';
      await this.prisma.migrationRun.update({
        where: { id },
        data: { status: MigrationRunStatus.FAILED, failureMessage: message, finishedAt: new Date() },
      });
      throw error;
    }
  }
}
