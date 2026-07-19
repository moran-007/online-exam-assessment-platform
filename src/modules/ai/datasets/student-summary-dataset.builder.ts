import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttemptStatus,
  AttendanceStatus,
  ClassMemberStatus,
  LessonRecordStatus,
  LessonSessionStatus,
  Prisma,
  ScratchAssignmentStatus,
  ScratchWorkStatus,
  UserStatus,
  UserType,
  WrongQuestionSourceType,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { ratio } from '../../statistics/statistics-math';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSummaryDataset } from './dataset-validator';
import { EvidenceCollector } from './evidence-collector';
import {
  buildExamPerformance,
  buildLessonActivity,
  buildScratchActivity,
  collectKnowledgeValue,
  collectStudentValue,
} from './student-summary-activities';
import {
  aggregateKnowledgePoints,
  aggregateQuestionTypes,
  programmingSummary,
  type StudentAnswerFact,
} from './student-summary-aggregates';
import {
  MAX_SELECTED_EXAMS,
  STUDENT_ATTEMPT_SELECT,
  STUDENT_EXAM_SELECT,
  STUDENT_LESSON_SELECT,
  STUDENT_SCRATCH_SELECT,
  WRONG_QUESTION_SELECT,
  type NormalizedStudentSummaryScope,
  type StudentAttempt,
  type StudentLesson,
  type StudentScratchWork,
  type StudentSummaryDatasetInput,
} from './student-summary-data';
import type { StudentSummaryDataset } from './summary-dataset';

export type StudentSummaryScopeInput = {
  studentId: string;
  courseId?: string;
  examIds?: string[];
  from?: string;
  to?: string;
};

@Injectable()
export class StudentSummaryDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async build(input: StudentSummaryScopeInput, user: RequestUser): Promise<StudentSummaryDataset> {
    await this.dataScope.assertStudentSummaryAccessible(user, input.studentId);
    const student = await this.prisma.user.findFirst({
      where: {
        id: input.studentId,
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const scope = this.normalizeScope(input);
    const exams = await this.selectExams(scope, user);
    const examIds = exams.map((exam) => exam.id);
    const attempts = examIds.length ? await this.prisma.examAttempt.findMany({
      where: { userId: student.id, examId: { in: examIds }, submittedAt: { not: null } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: STUDENT_ATTEMPT_SELECT,
    }) : [];
    const latestAttempts = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      if (!latestAttempts.has(attempt.examId)) latestAttempts.set(attempt.examId, attempt);
    }
    const gradedAttempts = [...latestAttempts.values()].filter((attempt) => attempt.status === AttemptStatus.GRADED);
    const answers = gradedAttempts.flatMap((attempt) => attempt.answers);
    const answerFacts = this.answerFacts(answers);
    const attemptIds = gradedAttempts.map((attempt) => attempt.id);
    const [wrongQuestions, judgeSubmissions, lessons, scratchWorks] = await Promise.all([
      this.wrongQuestions(scope, examIds),
      attemptIds.length ? this.prisma.judgeSubmission.findMany({
        where: { studentId: student.id, attemptId: { in: attemptIds } },
        select: { status: true, score: true },
      }) : [],
      this.lessons(scope),
      this.scratchWorks(scope),
    ]);

    return this.dataset({
      studentId: student.id,
      scope,
      exams,
      latestAttempts,
      gradedAttempts,
      answers: answerFacts,
      wrongQuestions,
      judgeSubmissions,
      lessons,
      scratchWorks,
    });
  }

  private async selectExams(scope: NormalizedStudentSummaryScope, user: RequestUser) {
    const [examScope, studentClasses] = await Promise.all([
      this.dataScope.examWhere(user),
      this.prisma.classStudent.findMany({
        where: {
          studentId: scope.studentId,
          status: ClassMemberStatus.ACTIVE,
          classGroup: { deletedAt: null, status: 'active' },
        },
        select: { classId: true },
      }),
    ]);
    const requestedIds = scope.examIds;
    const time = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
    const where: Prisma.ExamWhereInput = {
      deletedAt: null,
      ...(scope.courseId ? { courseId: scope.courseId } : {}),
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
      ...(Object.keys(time).length ? { endTime: time } : {}),
      AND: [
        examScope,
        {
          OR: [
            { classId: { in: studentClasses.map((item) => item.classId) } },
            { attempts: { some: { userId: scope.studentId } } },
          ],
        },
      ],
    };
    const exams = await this.prisma.exam.findMany({
      where,
      orderBy: [{ endTime: 'desc' }, { id: 'desc' }],
      take: requestedIds.length || MAX_SELECTED_EXAMS,
      select: STUDENT_EXAM_SELECT,
    });
    if (requestedIds.length && exams.length !== requestedIds.length) {
      throw new ForbiddenException('所选考试不存在、学生不在范围内或当前教师无权访问');
    }
    return exams.sort((left, right) => left.endTime.getTime() - right.endTime.getTime());
  }

  private wrongQuestions(scope: NormalizedStudentSummaryScope, selectedExamIds: string[]) {
    const time = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
    return this.prisma.wrongQuestion.findMany({
      where: {
        studentId: scope.studentId,
        question: { deletedAt: null, ...(scope.courseId ? { courseId: scope.courseId } : {}) },
        ...(Object.keys(time).length ? { lastWrongAt: time } : {}),
        ...(scope.examIds.length ? {
          sourceType: WrongQuestionSourceType.EXAM,
          sourceId: { in: selectedExamIds },
        } : {}),
      },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }, { id: 'asc' }],
      take: 20,
      select: WRONG_QUESTION_SELECT,
    });
  }

  private lessons(scope: NormalizedStudentSummaryScope): Promise<StudentLesson[]> {
    const startsAt = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
    return this.prisma.lessonSession.findMany({
      where: {
        ...(Object.keys(startsAt).length ? { startsAt } : {}),
        classGroup: {
          deletedAt: null,
          ...(scope.courseId ? { courseId: scope.courseId } : {}),
          students: { some: { studentId: scope.studentId, status: ClassMemberStatus.ACTIVE } },
        },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        ...STUDENT_LESSON_SELECT,
        attendance: {
          where: { studentId: scope.studentId },
          select: STUDENT_LESSON_SELECT.attendance.select,
        },
      },
    });
  }

  private scratchWorks(scope: NormalizedStudentSummaryScope): Promise<StudentScratchWork[]> {
    const startsAt = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
    return this.prisma.scratchWork.findMany({
      where: {
        studentId: scope.studentId,
        assignment: {
          status: ScratchAssignmentStatus.PUBLISHED,
          session: {
            ...(Object.keys(startsAt).length ? { startsAt } : {}),
            classGroup: {
              deletedAt: null,
              ...(scope.courseId ? { courseId: scope.courseId } : {}),
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: STUDENT_SCRATCH_SELECT,
    });
  }

  private answerFacts(answers: StudentAttempt['answers']): StudentAnswerFact[] {
    return answers.map((answer) => ({
      type: answer.question.type.toLowerCase(),
      score: Number(answer.score),
      maxScore: Number(answer.currentEvaluation?.maxScore ?? answer.question.defaultScore),
      isCorrect: answer.isCorrect,
      knowledgePoints: answer.question.knowledgePoints.map((item) => item.knowledgePoint),
    }));
  }

  private dataset(input: StudentSummaryDatasetInput): StudentSummaryDataset {
    const generatedAt = new Date().toISOString();
    const evidence = new EvidenceCollector(generatedAt);
    const byExam = input.latestAttempts;
    const statusCounts = {
      graded: input.exams.filter((exam) => byExam.get(exam.id)?.status === AttemptStatus.GRADED).length,
      notSubmitted: input.exams.filter((exam) => !byExam.has(exam.id)).length,
      ungraded: input.exams.filter((exam) => byExam.has(exam.id) && byExam.get(exam.id)?.status !== AttemptStatus.GRADED).length,
    };
    const questionTypes = aggregateQuestionTypes(input.answers);
    const knowledgePoints = aggregateKnowledgePoints(input.answers);
    const programming = programmingSummary(input.judgeSubmissions.map((item) => ({
      status: item.status,
      score: item.score === null ? null : Number(item.score),
    })));
    const publishedLessons = input.lessons.filter((lesson) => lesson.lessonRecord?.status === LessonRecordStatus.PUBLISHED);
    const attendance = input.lessons.flatMap((lesson) => lesson.attendance).filter((item) => item.confirmedAt);
    const attendanceCount = (status: AttendanceStatus) => attendance.filter((item) => item.status === status).length;
    const attendedStatuses = new Set<AttendanceStatus>([
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.EARLY_LEAVE,
      AttendanceStatus.MAKEUP,
    ]);
    const attendedCount = attendance.filter((item) => attendedStatuses.has(item.status)).length;
    const scheduledLessonCount = input.lessons.filter((lesson) => lesson.status !== LessonSessionStatus.CANCELLED).length;
    const completedLessonCount = input.lessons.filter((lesson) => lesson.status === LessonSessionStatus.COMPLETED).length;
    const homeworkAssignmentCount = publishedLessons.filter((lesson) => lesson.lessonRecord?.publicHomework?.trim()).length;
    const scratchSubmittedCount = input.scratchWorks.filter((work) => work.status !== ScratchWorkStatus.DRAFT).length;
    const scratchReviewedCount = input.scratchWorks.filter((work) => work.reviews.length > 0).length;
    const evidenceDensity = statusCounts.graded + publishedLessons.length + attendance.length + scratchReviewedCount;
    const course = input.exams.find((exam) => exam.courseId === input.scope.courseId) ?? input.exams[0];
    const lessonCourse = input.lessons.find((lesson) => lesson.classGroup.courseId === input.scope.courseId)
      ?? input.lessons[0];
    const dataset: StudentSummaryDataset = {
      type: 'student',
      generationMode: evidenceDensity >= 3 ? 'analysis' : 'fact_card',
      datasetVersion: 'student-summary/v2',
      generatedAt,
      dataCoverage: {
        from: input.scope.from?.toISOString() ?? null,
        to: input.scope.to?.toISOString() ?? null,
        includes: [
          'selected_exams', 'latest_submitted_attempt_per_exam', 'graded_scores',
          'question_type_performance', 'knowledge_point_performance',
          'wrong_question_counters', 'programming_judge_results', 'lesson_sessions',
          'confirmed_attendance', 'published_learning_goals', 'published_class_performance',
          'published_homework_assignments',
          'scratch_work_versions', 'scratch_submission_status', 'teacher_scratch_reviews',
          'scratch_judge_status',
        ],
        excludes: [
          'unpublished_lesson_records', 'internal_teaching_notes', 'internal_class_performance',
          'homework_submission_results', 'scratch_project_contents', 'scratch_external_identity',
          'answer_text', 'ungraded_scores', 'parent_data',
        ],
      },
      student: { id: input.studentId, alias: '该学生' },
      scope: {
        courseId: input.scope.courseId ?? null,
        courseName: input.scope.courseId
          ? course?.course.name ?? lessonCourse?.classGroup.course?.name ?? null
          : null,
        examIds: input.exams.map((exam) => exam.id),
      },
      coverage: {
        selectedExamCount: collectStudentValue(evidence, input.studentId, 'selectedExamCount', input.exams.length, 'exam'),
        gradedExamCount: collectStudentValue(evidence, input.studentId, 'gradedExamCount', statusCounts.graded, 'exam'),
        notSubmittedExamCount: collectStudentValue(evidence, input.studentId, 'notSubmittedExamCount', statusCounts.notSubmitted, 'exam'),
        ungradedExamCount: collectStudentValue(evidence, input.studentId, 'ungradedExamCount', statusCounts.ungraded, 'exam'),
        gradedAnswerCount: collectStudentValue(evidence, input.studentId, 'gradedAnswerCount', input.answers.length, 'answer'),
        scheduledLessonCount: collectStudentValue(evidence, input.studentId, 'scheduledLessonCount', scheduledLessonCount, 'lesson'),
        completedLessonCount: collectStudentValue(evidence, input.studentId, 'completedLessonCount', completedLessonCount, 'lesson'),
        attendanceRecordCount: collectStudentValue(evidence, input.studentId, 'attendanceRecordCount', attendance.length, 'attendance'),
        publishedLessonRecordCount: collectStudentValue(evidence, input.studentId, 'publishedLessonRecordCount', publishedLessons.length, 'lesson_record'),
        homeworkAssignmentCount: collectStudentValue(evidence, input.studentId, 'homeworkAssignmentCount', homeworkAssignmentCount, 'homework'),
        scratchWorkCount: collectStudentValue(evidence, input.studentId, 'scratch.workCount', input.scratchWorks.length, 'work'),
        scratchSubmittedCount: collectStudentValue(evidence, input.studentId, 'scratch.submittedCount', scratchSubmittedCount, 'work'),
        scratchReviewedCount: collectStudentValue(evidence, input.studentId, 'scratch.reviewedCount', scratchReviewedCount, 'review'),
      },
      examPerformance: input.exams.map((exam) => buildExamPerformance(evidence, input.studentId, exam, byExam.get(exam.id))),
      questionTypes: questionTypes.map((item) => ({
        type: item.type,
        answerCount: collectStudentValue(evidence, input.studentId, `questionType.${item.type}.answerCount`, item.answerCount, 'answer'),
        correctRate: collectStudentValue(evidence, input.studentId, `questionType.${item.type}.correctRate`, item.correctRate, 'ratio'),
        scoreRate: collectStudentValue(evidence, input.studentId, `questionType.${item.type}.scoreRate`, item.scoreRate, 'ratio'),
      })),
      knowledgePoints: knowledgePoints.map((item) => ({
        knowledgePointId: item.id,
        name: item.name,
        answerCount: collectKnowledgeValue(evidence, item.id, 'studentAnswerCount', item.answerCount, 'answer'),
        correctRate: collectKnowledgeValue(evidence, item.id, 'studentCorrectRate', item.correctRate, 'ratio'),
        scoreRate: collectKnowledgeValue(evidence, item.id, 'studentScoreRate', item.scoreRate, 'ratio'),
      })),
      wrongQuestions: input.wrongQuestions.map((item) => ({
        questionId: item.questionId,
        title: item.question.title,
        questionType: item.question.type.toLowerCase(),
        wrongCount: evidence.collect({
          sourceType: 'wrong_question', sourceId: item.id, metric: 'wrongCount',
          path: `/students/${input.studentId}/wrong-questions/${item.id}/wrongCount`, value: item.wrongCount, unit: 'event',
        }),
        masteryStatus: evidence.collect({
          sourceType: 'wrong_question', sourceId: item.id, metric: 'masteryStatus',
          path: `/students/${input.studentId}/wrong-questions/${item.id}/masteryStatus`,
          value: item.masteryStatus.toLowerCase(), unit: 'status',
        }),
      })),
      programming: {
        submissionCount: collectStudentValue(evidence, input.studentId, 'programming.submissionCount', programming.submissionCount, 'submission'),
        acceptedCount: collectStudentValue(evidence, input.studentId, 'programming.acceptedCount', programming.acceptedCount, 'submission'),
        acceptedRate: collectStudentValue(evidence, input.studentId, 'programming.acceptedRate', programming.acceptedRate, 'ratio'),
        averageScore: collectStudentValue(evidence, input.studentId, 'programming.averageScore', programming.averageScore, 'score'),
      },
      attendance: {
        confirmedCount: collectStudentValue(evidence, input.studentId, 'attendance.confirmedCount', attendance.length, 'attendance'),
        presentCount: collectStudentValue(evidence, input.studentId, 'attendance.presentCount', attendanceCount(AttendanceStatus.PRESENT), 'attendance'),
        lateCount: collectStudentValue(evidence, input.studentId, 'attendance.lateCount', attendanceCount(AttendanceStatus.LATE), 'attendance'),
        leaveCount: collectStudentValue(evidence, input.studentId, 'attendance.leaveCount', attendanceCount(AttendanceStatus.LEAVE), 'attendance'),
        absentCount: collectStudentValue(evidence, input.studentId, 'attendance.absentCount', attendanceCount(AttendanceStatus.ABSENT), 'attendance'),
        attendanceRate: collectStudentValue(evidence, input.studentId, 'attendance.attendanceRate', ratio(attendedCount, attendance.length), 'ratio'),
      },
      lessons: input.lessons.map((lesson) => buildLessonActivity(evidence, input.studentId, lesson)),
      scratchWorks: input.scratchWorks.map((work) => buildScratchActivity(evidence, input.studentId, work)),
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }

  private normalizeScope(input: StudentSummaryScopeInput): NormalizedStudentSummaryScope {
    const examIds = [...new Set(input.examIds ?? [])].sort();
    if (examIds.length > MAX_SELECTED_EXAMS) throw new BadRequestException(`一次最多选择 ${MAX_SELECTED_EXAMS} 场考试`);
    const from = this.date(input.from, '开始时间');
    const to = this.date(input.to, '结束时间');
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    return { studentId: input.studentId, courseId: input.courseId, examIds, from, to };
  }

  private date(value: string | undefined, label: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${label}格式无效`);
    return date;
  }
}
