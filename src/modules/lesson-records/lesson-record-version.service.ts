import { Injectable } from '@nestjs/common';
import { LessonRecordVersionAction, Prisma } from '@prisma/client';

@Injectable()
export class LessonRecordVersionService {
  async append(
    tx: Prisma.TransactionClient,
    recordId: string,
    action: LessonRecordVersionAction,
    actorId?: string,
    reason?: string,
  ) {
    const record = await tx.lessonRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: {
        assets: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            fileAsset: {
              select: { id: true, fileName: true, mimeType: true, fileSize: true, sha256: true },
            },
          },
        },
      },
    });
    const snapshot = {
      sessionId: record.sessionId,
      status: record.status,
      version: record.version,
      internalTeachingNotes: record.internalTeachingNotes,
      internalClassPerformance: record.internalClassPerformance,
      publicTeachingContent: record.publicTeachingContent,
      publicLearningGoal: record.publicLearningGoal,
      publicClassPerformance: record.publicClassPerformance,
      publicHomework: record.publicHomework,
      publicNextPlan: record.publicNextPlan,
      publicMaterials: record.publicMaterials,
      submittedAt: record.submittedAt?.toISOString() ?? null,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      assets: record.assets.map((asset) => ({
        id: asset.id,
        audience: asset.audience,
        title: asset.title,
        note: asset.note,
        sortOrder: asset.sortOrder,
        file: {
          id: asset.fileAsset.id,
          fileName: asset.fileAsset.fileName,
          mimeType: asset.fileAsset.mimeType,
          fileSize: asset.fileAsset.fileSize.toString(),
          sha256: asset.fileAsset.sha256,
        },
      })),
    } satisfies Prisma.InputJsonObject;

    return tx.lessonRecordVersion.create({
      data: {
        recordId,
        version: record.version,
        status: record.status,
        action,
        snapshotJson: snapshot,
        reason: this.clean(reason),
        createdBy: actorId,
      },
    });
  }

  private clean(value?: string) {
    const result = value?.trim();
    return result || undefined;
  }
}

