import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryType, Prisma } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSummaryDataset } from './dataset-validator';
import { EvidenceCollector } from './evidence-collector';
import type { LessonAssistantDataset } from './summary-dataset';
import { AiDataPermissionService } from '../ai-data-permission.service';

@Injectable()
export class LessonAssistantDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly aiDataPermissions: AiDataPermissionService,
  ) {}

  async build(sessionId: string, user: RequestUser): Promise<LessonAssistantDataset> {
    await this.aiDataPermissions.assertSummaryAllowed(AiSummaryType.LESSON, user);
    const session = await this.prisma.lessonSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        classId: true,
        classGroup: { select: { name: true } },
        teacher: { select: { id: true, realName: true, username: true } },
        lessonRecord: {
          select: {
            id: true,
            status: true,
            publicTeachingContent: true,
            publicLearningGoal: true,
            publicClassPerformance: true,
            publicHomework: true,
            publicNextPlan: true,
            internalTeachingNotes: true,
            internalClassPerformance: true,
          },
        },
      },
    });
    if (!session) throw new NotFoundException('课次不存在');
    await this.dataScope.assertAcademicClassAccessible(user, session.classId);
    const canUseTeacherName = await this.aiDataPermissions.isAllowed('teacher_identity', user);
    return this.dataset(session, canUseTeacherName);
  }

  private dataset(session: LessonAssistantSession, canUseTeacherName: boolean): LessonAssistantDataset {
    const generatedAt = new Date().toISOString();
    const evidence = new EvidenceCollector(generatedAt);
    const record = session.lessonRecord;
    const recordValue = (metric: string, value: string | null) => evidence.collect({
      sourceType: record ? 'lesson_record' as const : 'lesson_session' as const,
      sourceId: record?.id ?? session.id,
      metric,
      path: `/lesson-sessions/${session.id}/assistant/${metric}`,
      value,
      unit: 'text',
    });
    const dataset: LessonAssistantDataset = {
      type: 'lesson',
      datasetVersion: 'lesson-assistant/v1',
      generatedAt,
      dataCoverage: {
        from: session.startsAt.toISOString(),
        to: session.startsAt.toISOString(),
        includes: [
          'current_lesson_record', 'public_teaching_content', 'public_learning_goal',
          'public_class_performance', 'public_homework', 'public_next_plan',
          'teacher_internal_notes_for_drafting_only',
        ],
        excludes: ['student_identity', 'student_answers', 'parent_data', 'other_lesson_records'],
      },
      session: {
        id: session.id,
        title: session.title,
        startsAt: session.startsAt.toISOString(),
        classAlias: session.classGroup.name,
      },
      teacher: {
        id: canUseTeacherName ? (session.teacher?.id ?? null) : null,
        alias: canUseTeacherName
          ? (session.teacher?.realName?.trim() || session.teacher?.username || '未指定教师')
          : '授课教师',
      },
      currentRecord: {
        status: evidence.collect({
          sourceType: record ? 'lesson_record' : 'lesson_session',
          sourceId: record?.id ?? session.id,
          metric: 'status',
          path: `/lesson-sessions/${session.id}/assistant/status`,
          value: record?.status.toLowerCase() ?? 'none',
          unit: 'status',
        }),
        teachingContent: recordValue('teachingContent', record?.publicTeachingContent ?? null),
        learningGoal: recordValue('learningGoal', record?.publicLearningGoal ?? null),
        classPerformance: recordValue('classPerformance', record?.publicClassPerformance ?? null),
        homework: recordValue('homework', record?.publicHomework ?? null),
        nextPlan: recordValue('nextPlan', record?.publicNextPlan ?? null),
        internalTeachingNotes: recordValue('internalTeachingNotes', record?.internalTeachingNotes ?? null),
        internalClassPerformance: recordValue('internalClassPerformance', record?.internalClassPerformance ?? null),
      },
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }
}

type LessonAssistantSession = Prisma.LessonSessionGetPayload<{
  select: {
    id: true;
    title: true;
    startsAt: true;
    classId: true;
    classGroup: { select: { name: true } };
    teacher: { select: { id: true; realName: true; username: true } };
    lessonRecord: {
      select: {
        id: true;
        status: true;
        publicTeachingContent: true;
        publicLearningGoal: true;
        publicClassPerformance: true;
        publicHomework: true;
        publicNextPlan: true;
        internalTeachingNotes: true;
        internalClassPerformance: true;
      };
    };
  };
}>;
