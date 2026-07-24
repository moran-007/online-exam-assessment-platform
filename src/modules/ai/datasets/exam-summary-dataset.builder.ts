import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../../statistics/dto/query-statistics.dto';
import { ratio } from '../../statistics/statistics-math';
import { StatisticsService } from '../../statistics/statistics.service';
import { assertSummaryDataset } from './dataset-validator';
import { EvidenceCollector } from './evidence-collector';
import type { ExamSummaryDataset } from './summary-dataset';
import { AiDataPermissionService } from '../ai-data-permission.service';

@Injectable()
export class ExamSummaryDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly statistics: StatisticsService,
    private readonly aiDataPermissions: AiDataPermissionService,
  ) {}

  async build(examId: string, user: RequestUser): Promise<ExamSummaryDataset> {
    await this.aiDataPermissions.assertSummaryAllowed(AiSummaryType.EXAM, user);
    await this.dataScope.assertExamAccessible(user, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { id: true, name: true, courseId: true, classId: true, course: { select: { name: true } } },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    const query = Object.assign(new QueryStatisticsDto(), { examId });
    const [detail, distribution, knowledgePoints, questions, classContext] = await Promise.all([
      this.statistics.examDetail(examId, user),
      this.statistics.scoreDistribution(query, user),
      this.statistics.knowledge(query, user),
      this.statistics.questionDiagnostics(query, user),
      this.classContext(exam.classId),
    ]);
    const generatedAt = new Date().toISOString();
    const evidence = new EvidenceCollector(generatedAt);
    const path = `/statistics/exams/${exam.id}`;
    const eligible = classContext?.studentCount ?? null;
    const dataset: ExamSummaryDataset = {
      type: 'exam',
      datasetVersion: 'exam-summary/v1',
      generatedAt,
      dataCoverage: {
        from: null,
        to: null,
        includes: ['exam', 'submitted_attempts', 'scores', 'questions', 'knowledge_points'],
        excludes: [
          'attendance', 'lessons', 'homework',
          ...(classContext ? [] : ['eligible_students', 'submission_rate']),
        ],
      },
      exam: {
        id: exam.id,
        name: exam.name,
        courseId: exam.courseId,
        courseName: exam.course.name,
        classId: exam.classId,
        className: classContext?.name ?? null,
      },
      participation: {
        eligible: evidence.collect({
          sourceType: classContext ? 'class' : 'exam', sourceId: classContext?.id ?? exam.id,
          metric: 'eligibleStudentCount', path: `${path}/participation/eligible`, value: eligible, unit: 'student',
        }),
        submitted: this.examValue(evidence, exam.id, 'submittedCount', `${path}/participation/submitted`, detail.submitCount, 'attempt'),
        graded: this.examValue(evidence, exam.id, 'gradedCount', `${path}/participation/graded`, detail.gradedCount, 'attempt'),
        submissionRate: this.examValue(
          evidence, exam.id, 'submissionRate', `${path}/participation/submissionRate`,
          eligible ? ratio(detail.submitCount, eligible) : null, 'ratio',
        ),
      },
      scores: {
        fullScore: this.examValue(evidence, exam.id, 'fullScore', `${path}/scores/full`, detail.fullScore, 'score'),
        average: this.examValue(evidence, exam.id, 'averageScore', `${path}/scores/average`, detail.averageScore, 'score'),
        median: this.examValue(evidence, exam.id, 'medianScore', `${path}/scores/median`, detail.medianScore, 'score'),
        minimum: this.examValue(evidence, exam.id, 'minimumScore', `${path}/scores/minimum`, detail.minScore, 'score'),
        maximum: this.examValue(evidence, exam.id, 'maximumScore', `${path}/scores/maximum`, detail.maxScore, 'score'),
      },
      distribution: distribution.buckets.map((bucket) => ({
        label: bucket.label,
        count: this.examValue(evidence, exam.id, `distribution.${bucket.label}.count`, `${path}/distribution/${bucket.label}/count`, bucket.count, 'attempt'),
        rate: this.examValue(evidence, exam.id, `distribution.${bucket.label}.rate`, `${path}/distribution/${bucket.label}/rate`, bucket.percent, 'ratio'),
      })),
      questions: questions.sort((left, right) => left.questionId.localeCompare(right.questionId)).map((question) => ({
        questionId: question.questionId,
        title: question.title,
        answerCount: this.questionValue(evidence, question.questionId, 'answerCount', question.answerCount, 'answer'),
        correctRate: this.questionValue(evidence, question.questionId, 'correctRate', question.correctRate, 'ratio'),
        averageScore: this.questionValue(evidence, question.questionId, 'averageScore', question.averageScore, 'score'),
        discrimination: this.questionValue(evidence, question.questionId, 'discrimination', question.discrimination, 'ratio'),
        anomalyCount: this.questionValue(evidence, question.questionId, 'anomalyCount', question.anomalyCount, 'answer'),
      })),
      knowledgePoints: knowledgePoints.sort((left, right) => left.knowledgePointId.localeCompare(right.knowledgePointId)).map((point) => ({
        knowledgePointId: point.knowledgePointId,
        name: point.name,
        answerCount: this.knowledgeValue(evidence, point.knowledgePointId, 'answerCount', point.answerCount, 'answer'),
        correctRate: this.knowledgeValue(evidence, point.knowledgePointId, 'correctRate', point.correctRate, 'ratio'),
      })),
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }

  private async classContext(classId: string | null) {
    if (!classId) return null;
    return this.prisma.classGroup.findFirst({
      where: { id: classId, deletedAt: null },
      select: { id: true, name: true, _count: { select: { students: true } } },
    }).then((row) => row ? { id: row.id, name: row.name, studentCount: row._count.students } : null);
  }

  private examValue<T extends number | null>(evidence: EvidenceCollector, id: string, metric: string, path: string, value: T, unit: string) {
    return evidence.collect({ sourceType: 'exam', sourceId: id, metric, path, value, unit });
  }

  private questionValue(evidence: EvidenceCollector, id: string, metric: string, value: number, unit: string) {
    return evidence.collect({ sourceType: 'question', sourceId: id, metric, path: `/statistics/questions/${id}/${metric}`, value, unit });
  }

  private knowledgeValue(evidence: EvidenceCollector, id: string, metric: string, value: number, unit: string) {
    return evidence.collect({ sourceType: 'knowledge_point', sourceId: id, metric, path: `/statistics/knowledge-points/${id}/${metric}`, value, unit });
  }
}
