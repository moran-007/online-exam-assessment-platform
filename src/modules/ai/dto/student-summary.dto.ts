import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_AI_OUTPUT_TOKENS,
  MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
} from '../ai-summary-limits';
import {
  AiDataCoverageDto,
  AiEvidenceRefDto,
  AiEvidencedNumberDto,
} from './ai-summary.dto';
import { SUMMARY_DATA_DOMAINS, type SummaryDataDomain } from '../datasets/summary-scope';

export class StudentSummaryScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 20 })
  @Transform(({ value }) => normalizeArray(value))
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true })
  examIds?: string[];

  @ApiPropertyOptional({ format: 'date-time', description: '按考试结束时间筛选' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: '按考试结束时间筛选' })
  @IsOptional() @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: SUMMARY_DATA_DOMAINS,
    description: '总结内容，可单选或多选；不传时包含上课、考试和作业',
  })
  @Transform(({ value }) => normalizeArray(value))
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(SUMMARY_DATA_DOMAINS, { each: true })
  summaryDomains?: SummaryDataDomain[];

  @ApiPropertyOptional({ minimum: 1, description: '时间筛选后取最近 N 场考试；不传时不限制考试数量' })
  @Transform(({ value }) => value === '' || value === undefined ? undefined : Number(value))
  @IsOptional() @IsInt() @Min(1)
  recentExamCount?: number;
}

export class CreateStudentSummaryTaskDto extends StudentSummaryScopeQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '本次输出上限；配置与本次均为空时由供应商决定',
    minimum: MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_STUDENT_SUMMARY_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: '仅重试相同失败任务时使用；true 表示用户已确认本次会再次调用供应商并记录用量',
    default: false,
  })
  @IsOptional() @IsBoolean()
  confirmRetry?: boolean;
}

export class EstimateStudentSummaryBatchDto extends StudentSummaryScopeQueryDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 20 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
  studentIds: string[];

  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '每个学生请求的输出上限；配置与本次均为空时由供应商决定',
    minimum: MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_STUDENT_SUMMARY_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class StudentSummaryBatchEstimateDto {
  @ApiProperty() taskCount: number;
  @ApiProperty({ nullable: true }) requestedOutputTokensPerTask: number | null;
  @ApiProperty({ description: '用量未报告时每个任务采用的公开估算预留上界' })
  reservationOutputTokensPerTask: number;
  @ApiProperty() estimatedReservedTokens: number;
  @ApiProperty({ nullable: true }) remainingTokens: number | null;
  @ApiProperty() withinLocalBudget: boolean;
  @ApiProperty() confirmationRequired: boolean;
  @ApiProperty() maxBatchSize: number;
  @ApiProperty({ format: 'uuid' }) configId: string;
  @ApiProperty() model: string;
}

export class AiEvidencedStringDto {
  @ApiProperty() value: string;
  @ApiProperty() evidenceRef: string;
}

export class AiNullableEvidencedStringDto {
  @ApiProperty({ nullable: true }) value: string | null;
  @ApiProperty() evidenceRef: string;
}

export class AiNullableEvidencedNumberDto {
  @ApiProperty({ nullable: true }) value: number | null;
  @ApiProperty() evidenceRef: string;
}

export class AiStudentContextDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() alias: string;
}

export class AiStudentSummaryScopeDto {
  @ApiProperty({ nullable: true, format: 'uuid' }) courseId: string | null;
  @ApiProperty({ nullable: true }) courseName: string | null;
  @ApiProperty({ type: [String], format: 'uuid' }) examIds: string[];
  @ApiProperty({ type: [String], enum: SUMMARY_DATA_DOMAINS }) summaryDomains: SummaryDataDomain[];
  @ApiProperty({ nullable: true, minimum: 1 }) recentExamCount: number | null;
}

export class AiStudentCoverageMetricsDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) selectedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) gradedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submittedAttemptCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) gradedAttemptCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) notSubmittedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) ungradedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) gradedAnswerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scheduledLessonCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) completedLessonCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) attendanceRecordCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) publishedLessonRecordCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) homeworkAssignmentCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scratchWorkCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scratchSubmittedCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scratchReviewedCount: AiEvidencedNumberDto;
}

export class AiStudentExamPerformanceDto {
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty({ format: 'date-time' }) endedAt: string;
  @ApiProperty({ type: () => AiEvidencedStringDto }) status: AiEvidencedStringDto;
  @ApiProperty({ nullable: true, format: 'date-time' }) submittedAt: string | null;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) score: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) fullScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentExamAttemptDto {
  @ApiProperty({ format: 'uuid' }) attemptId: string;
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty({ format: 'date-time' }) submittedAt: string;
  @ApiProperty({ type: () => AiEvidencedStringDto }) status: AiEvidencedStringDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) score: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) fullScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentQuestionTypeFactDto {
  @ApiProperty() type: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentKnowledgePointFactDto {
  @ApiProperty({ format: 'uuid' }) knowledgePointId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentWrongQuestionFactDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty() questionType: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) wrongCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedStringDto }) masteryStatus: AiEvidencedStringDto;
}

export class AiStudentProgrammingFactDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submissionCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) acceptedCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) acceptedRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) averageScore: AiEvidencedNumberDto;
}

export class AiStudentAttendanceFactDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) confirmedCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) presentCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) lateCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) leaveCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) absentCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) attendanceRate: AiEvidencedNumberDto;
}

export class AiStudentLessonFactDto {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty() title: string;
  @ApiProperty({ format: 'date-time' }) startsAt: string;
  @ApiProperty({ type: () => AiEvidencedStringDto }) status: AiEvidencedStringDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) lessonHours: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) attendanceStatus: AiNullableEvidencedStringDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) learningGoal: AiNullableEvidencedStringDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) classPerformance: AiNullableEvidencedStringDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) homework: AiNullableEvidencedStringDto;
}

export class AiStudentScratchWorkFactDto {
  @ApiProperty({ format: 'uuid' }) workId: string;
  @ApiProperty() assignmentTitle: string;
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty({ type: () => AiEvidencedStringDto }) status: AiEvidencedStringDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) versionCount: AiEvidencedNumberDto;
  @ApiProperty({ nullable: true, format: 'date-time' }) submittedAt: string | null;
  @ApiProperty({ type: () => AiNullableEvidencedNumberDto }) latestReviewScore: AiNullableEvidencedNumberDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) latestReviewComment: AiNullableEvidencedStringDto;
  @ApiProperty({ type: () => AiNullableEvidencedStringDto }) latestJudgeStatus: AiNullableEvidencedStringDto;
  @ApiProperty({ type: () => AiNullableEvidencedNumberDto }) latestJudgeScore: AiNullableEvidencedNumberDto;
}

export class StudentSummaryDatasetPreviewDto {
  @ApiProperty() inputHash: string;
  @ApiProperty() datasetVersion: string;
  @ApiProperty({ enum: ['analysis', 'fact_card'] }) generationMode: string;
  @ApiProperty({ format: 'date-time' }) generatedAt: string;
  @ApiProperty({ type: () => AiDataCoverageDto }) dataCoverage: AiDataCoverageDto;
  @ApiProperty({ type: () => AiStudentContextDto }) student: AiStudentContextDto;
  @ApiProperty({ type: () => AiStudentSummaryScopeDto }) scope: AiStudentSummaryScopeDto;
  @ApiProperty({ type: () => AiStudentCoverageMetricsDto }) coverage: AiStudentCoverageMetricsDto;
  @ApiProperty({ type: () => [AiStudentExamPerformanceDto] }) examPerformance: AiStudentExamPerformanceDto[];
  @ApiProperty({ type: () => [AiStudentExamAttemptDto] }) examAttemptHistory: AiStudentExamAttemptDto[];
  @ApiProperty({ type: () => [AiStudentQuestionTypeFactDto] }) questionTypes: AiStudentQuestionTypeFactDto[];
  @ApiProperty({ type: () => [AiStudentKnowledgePointFactDto] }) knowledgePoints: AiStudentKnowledgePointFactDto[];
  @ApiProperty({ type: () => [AiStudentWrongQuestionFactDto] }) wrongQuestions: AiStudentWrongQuestionFactDto[];
  @ApiProperty({ type: () => AiStudentProgrammingFactDto }) programming: AiStudentProgrammingFactDto;
  @ApiProperty({ type: () => AiStudentAttendanceFactDto }) attendance: AiStudentAttendanceFactDto;
  @ApiProperty({ type: () => [AiStudentLessonFactDto] }) lessons: AiStudentLessonFactDto[];
  @ApiProperty({ type: () => [AiStudentScratchWorkFactDto] }) scratchWorks: AiStudentScratchWorkFactDto[];
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
}

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
