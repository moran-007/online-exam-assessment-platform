import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttemptStatus,
  AttendanceStatus,
  ClassMemberStatus,
  LessonRecordStatus,
  LessonSessionStatus,
  Prisma,
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
  aggregateKnowledgePoints,
  aggregateQuestionTypes,
  programmingSummary,
  type StudentAnswerFact,
} from './student-summary-aggregates';
import type { StudentSummaryDataset } from './summary-dataset';

const MAX_SELECTED_EXAMS = 20;

const STUDENT_EXAM_SELECT = {
  id: true,
  name: true,
  courseId: true,
  endTime: true,
  course: { select: { name: true } },
  paper: { select: { totalScore: true } },
} satisfies Prisma.ExamSelect;

const STUDENT_ATTEMPT_SELECT = {
  id: true,
  examId: true,
  status: true,
  submittedAt: true,
  totalScore: true,
  answers: {
    select: {
      id: true,
      score: true,
      isCorrect: true,
      currentEvaluation: { select: { maxScore: true } },
      question: {
        select: {
          id: true,
          type: true,
          defaultScore: true,
          knowledgePoints: {
            select: { knowledgePoint: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.ExamAttemptSelect;

const WRONG_QUESTION_SELECT = {
  id: true,
  questionId: true,
  wrongCount: true,
  masteryStatus: true,
  question: { select: { title: true, type: true } },
} satisfies Prisma.WrongQuestionSelect;

const STUDENT_LESSON_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  status: true,
  lessonHours: true,
  classGroup: { select: { courseId: true, course: { select: { name: true } } } },
  attendance: { select: { id: true, status: true, confirmedAt: true } },
  lessonRecord: {
    select: {
      id: true,
      status: true,
      publicLearningGoal: true,
      publicClassPerformance: true,
      publicHomework: true,
    },
  },
} satisfies Prisma.LessonSessionSelect;

type StudentExam = Prisma.ExamGetPayload<{ select: typeof STUDENT_EXAM_SELECT }>;
type StudentAttempt = Prisma.ExamAttemptGetPayload<{ select: typeof STUDENT_ATTEMPT_SELECT }>;
type StudentWrongQuestion = Prisma.WrongQuestionGetPayload<{ select: typeof WRONG_QUESTION_SELECT }>;
type StudentLesson = Prisma.LessonSessionGetPayload<{ select: typeof STUDENT_LESSON_SELECT }>;

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
    const [wrongQuestions, judgeSubmissions, lessons] = await Promise.all([
      this.wrongQuestions(scope, examIds),
      attemptIds.length ? this.prisma.judgeSubmission.findMany({
        where: { studentId: student.id, attemptId: { in: attemptIds } },
        select: { status: true, score: true },
      }) : [],
      this.lessons(scope),
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
    });
  }

  private async selectExams(scope: NormalizedScope, user: RequestUser) {
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

  private wrongQuestions(scope: NormalizedScope, selectedExamIds: string[]) {
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

  private lessons(scope: NormalizedScope): Promise<StudentLesson[]> {
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

  private answerFacts(answers: StudentAttempt['answers']): StudentAnswerFact[] {
    return answers.map((answer) => ({
      type: answer.question.type.toLowerCase(),
      score: Number(answer.score),
      maxScore: Number(answer.currentEvaluation?.maxScore ?? answer.question.defaultScore),
      isCorrect: answer.isCorrect,
      knowledgePoints: answer.question.knowledgePoints.map((item) => item.knowledgePoint),
    }));
  }

  private dataset(input: DatasetInput): StudentSummaryDataset {
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
    const evidenceDensity = statusCounts.graded + publishedLessons.length + attendance.length;
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
        ],
        excludes: [
          'unpublished_lesson_records', 'internal_teaching_notes', 'internal_class_performance',
          'homework_submission_results', 'answer_text', 'ungraded_scores', 'parent_data',
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
        selectedExamCount: this.studentValue(evidence, input.studentId, 'selectedExamCount', input.exams.length, 'exam'),
        gradedExamCount: this.studentValue(evidence, input.studentId, 'gradedExamCount', statusCounts.graded, 'exam'),
        notSubmittedExamCount: this.studentValue(evidence, input.studentId, 'notSubmittedExamCount', statusCounts.notSubmitted, 'exam'),
        ungradedExamCount: this.studentValue(evidence, input.studentId, 'ungradedExamCount', statusCounts.ungraded, 'exam'),
        gradedAnswerCount: this.studentValue(evidence, input.studentId, 'gradedAnswerCount', input.answers.length, 'answer'),
        scheduledLessonCount: this.studentValue(evidence, input.studentId, 'scheduledLessonCount', scheduledLessonCount, 'lesson'),
        completedLessonCount: this.studentValue(evidence, input.studentId, 'completedLessonCount', completedLessonCount, 'lesson'),
        attendanceRecordCount: this.studentValue(evidence, input.studentId, 'attendanceRecordCount', attendance.length, 'attendance'),
        publishedLessonRecordCount: this.studentValue(evidence, input.studentId, 'publishedLessonRecordCount', publishedLessons.length, 'lesson_record'),
        homeworkAssignmentCount: this.studentValue(evidence, input.studentId, 'homeworkAssignmentCount', homeworkAssignmentCount, 'homework'),
      },
      examPerformance: input.exams.map((exam) => this.examPerformance(evidence, input.studentId, exam, byExam.get(exam.id))),
      questionTypes: questionTypes.map((item) => ({
        type: item.type,
        answerCount: this.studentValue(evidence, input.studentId, `questionType.${item.type}.answerCount`, item.answerCount, 'answer'),
        correctRate: this.studentValue(evidence, input.studentId, `questionType.${item.type}.correctRate`, item.correctRate, 'ratio'),
        scoreRate: this.studentValue(evidence, input.studentId, `questionType.${item.type}.scoreRate`, item.scoreRate, 'ratio'),
      })),
      knowledgePoints: knowledgePoints.map((item) => ({
        knowledgePointId: item.id,
        name: item.name,
        answerCount: this.knowledgeValue(evidence, item.id, 'studentAnswerCount', item.answerCount, 'answer'),
        correctRate: this.knowledgeValue(evidence, item.id, 'studentCorrectRate', item.correctRate, 'ratio'),
        scoreRate: this.knowledgeValue(evidence, item.id, 'studentScoreRate', item.scoreRate, 'ratio'),
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
        submissionCount: this.studentValue(evidence, input.studentId, 'programming.submissionCount', programming.submissionCount, 'submission'),
        acceptedCount: this.studentValue(evidence, input.studentId, 'programming.acceptedCount', programming.acceptedCount, 'submission'),
        acceptedRate: this.studentValue(evidence, input.studentId, 'programming.acceptedRate', programming.acceptedRate, 'ratio'),
        averageScore: this.studentValue(evidence, input.studentId, 'programming.averageScore', programming.averageScore, 'score'),
      },
      attendance: {
        confirmedCount: this.studentValue(evidence, input.studentId, 'attendance.confirmedCount', attendance.length, 'attendance'),
        presentCount: this.studentValue(evidence, input.studentId, 'attendance.presentCount', attendanceCount(AttendanceStatus.PRESENT), 'attendance'),
        lateCount: this.studentValue(evidence, input.studentId, 'attendance.lateCount', attendanceCount(AttendanceStatus.LATE), 'attendance'),
        leaveCount: this.studentValue(evidence, input.studentId, 'attendance.leaveCount', attendanceCount(AttendanceStatus.LEAVE), 'attendance'),
        absentCount: this.studentValue(evidence, input.studentId, 'attendance.absentCount', attendanceCount(AttendanceStatus.ABSENT), 'attendance'),
        attendanceRate: this.studentValue(evidence, input.studentId, 'attendance.attendanceRate', ratio(attendedCount, attendance.length), 'ratio'),
      },
      lessons: input.lessons.map((lesson) => this.lessonActivity(evidence, input.studentId, lesson)),
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }

  private lessonActivity(
    evidence: EvidenceCollector,
    studentId: string,
    lesson: StudentLesson,
  ): StudentSummaryDataset['lessons'][number] {
    const attendance = lesson.attendance[0];
    const record = lesson.lessonRecord?.status === LessonRecordStatus.PUBLISHED
      ? lesson.lessonRecord
      : null;
    return {
      sessionId: lesson.id,
      title: lesson.title,
      startsAt: lesson.startsAt.toISOString(),
      status: evidence.collect({
        sourceType: 'lesson_session', sourceId: lesson.id, metric: 'status',
        path: `/students/${studentId}/lessons/${lesson.id}/status`,
        value: lesson.status.toLowerCase(), unit: 'status',
      }),
      lessonHours: evidence.collect({
        sourceType: 'lesson_session', sourceId: lesson.id, metric: 'lessonHours',
        path: `/students/${studentId}/lessons/${lesson.id}/lessonHours`,
        value: Number(lesson.lessonHours), unit: 'hour',
      }),
      attendanceStatus: evidence.collect({
        sourceType: attendance ? 'attendance' : 'lesson_session',
        sourceId: attendance?.id ?? lesson.id,
        metric: 'attendanceStatus',
        path: `/students/${studentId}/lessons/${lesson.id}/attendanceStatus`,
        value: attendance?.status.toLowerCase() ?? null,
        unit: 'status',
      }),
      learningGoal: this.lessonRecordValue(
        evidence, studentId, lesson.id, record?.id, 'learningGoal', record?.publicLearningGoal ?? null,
      ),
      classPerformance: this.lessonRecordValue(
        evidence, studentId, lesson.id, record?.id, 'classPerformance', record?.publicClassPerformance ?? null,
      ),
      homework: this.lessonRecordValue(
        evidence, studentId, lesson.id, record?.id, 'homework', record?.publicHomework ?? null,
      ),
    };
  }

  private lessonRecordValue(
    evidence: EvidenceCollector,
    studentId: string,
    sessionId: string,
    recordId: string | undefined,
    metric: string,
    value: string | null,
  ) {
    return evidence.collect({
      sourceType: recordId ? 'lesson_record' : 'lesson_session',
      sourceId: recordId ?? sessionId,
      metric,
      path: `/students/${studentId}/lessons/${sessionId}/${metric}`,
      value,
      unit: 'text',
    });
  }

  private examPerformance(
    evidence: EvidenceCollector,
    studentId: string,
    exam: DatasetInput['exams'][number],
    attempt?: DatasetInput['gradedAttempts'][number],
  ): StudentSummaryDataset['examPerformance'][number] {
    const graded = attempt?.status === AttemptStatus.GRADED;
    const status = !attempt ? 'not_submitted' : graded ? 'graded' : 'ungraded';
    const score = graded ? Number(attempt.totalScore) : null;
    const fullScore = Number(exam.paper.totalScore);
    const statusSource = attempt
      ? { sourceType: 'exam_attempt' as const, sourceId: attempt.id }
      : { sourceType: 'exam' as const, sourceId: exam.id };
    return {
      examId: exam.id,
      examName: exam.name,
      endedAt: exam.endTime.toISOString(),
      status: evidence.collect({
        ...statusSource, metric: `student.${studentId}.status`,
        path: `/students/${studentId}/exams/${exam.id}/status`, value: status, unit: 'status',
      }),
      submittedAt: attempt?.submittedAt?.toISOString() ?? null,
      score: evidence.collect({
        ...statusSource, metric: `student.${studentId}.score`,
        path: `/students/${studentId}/exams/${exam.id}/score`, value: score, unit: 'score',
      }),
      fullScore: evidence.collect({
        sourceType: 'exam', sourceId: exam.id, metric: 'fullScore',
        path: `/students/${studentId}/exams/${exam.id}/fullScore`, value: fullScore, unit: 'score',
      }),
      scoreRate: evidence.collect({
        ...statusSource, metric: `student.${studentId}.scoreRate`,
        path: `/students/${studentId}/exams/${exam.id}/scoreRate`,
        value: score === null ? null : ratio(score, fullScore), unit: 'ratio',
      }),
    };
  }

  private studentValue(evidence: EvidenceCollector, id: string, metric: string, value: number, unit: string) {
    return evidence.collect({
      sourceType: 'student', sourceId: id, metric,
      path: `/students/${id}/summary/${metric}`, value, unit,
    });
  }

  private knowledgeValue(evidence: EvidenceCollector, id: string, metric: string, value: number, unit: string) {
    return evidence.collect({
      sourceType: 'knowledge_point', sourceId: id, metric,
      path: `/students/summary/knowledge-points/${id}/${metric}`, value, unit,
    });
  }

  private normalizeScope(input: StudentSummaryScopeInput): NormalizedScope {
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

type NormalizedScope = {
  studentId: string;
  courseId?: string;
  examIds: string[];
  from?: Date;
  to?: Date;
};

type DatasetInput = {
  studentId: string;
  scope: NormalizedScope;
  exams: StudentExam[];
  latestAttempts: Map<string, StudentAttempt>;
  gradedAttempts: StudentAttempt[];
  answers: StudentAnswerFact[];
  wrongQuestions: StudentWrongQuestion[];
  judgeSubmissions: Array<{ status: string; score: Prisma.Decimal | null }>;
  lessons: StudentLesson[];
};
