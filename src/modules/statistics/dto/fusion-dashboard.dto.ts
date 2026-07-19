import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class FusionDashboardQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '家长切换关联学生或教师下钻单个学生时使用' })
  @IsOptional() @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  endDate?: string;
}

export class FusionAssessmentMetricsDto {
  @ApiProperty() exams: number;
  @ApiProperty() submittedAttempts: number;
  @ApiProperty() gradedAttempts: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() pendingManual: number;
  @ApiProperty() activeWrongQuestions: number;
}

export class FusionAcademicMetricsDto {
  @ApiProperty() scheduledLessons: number;
  @ApiProperty() completedLessons: number;
  @ApiProperty() publishedLessonRecords: number;
  @ApiProperty() confirmedAttendance: number;
  @ApiProperty() attendanceRate: number;
  @ApiProperty() absentCount: number;
  @ApiProperty() assignedLessonHours: number;
  @ApiProperty() consumedLessonHours: number;
  @ApiProperty() remainingLessonHours: number;
}

export class FusionRecentExamDto {
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty() courseName: string;
  @ApiProperty() status: string;
  @ApiProperty() submitCount: number;
  @ApiProperty() gradedCount: number;
  @ApiProperty() averageScore: number;
  @ApiProperty({ format: 'date-time' }) occurredAt: Date;
}

export class TeacherPerformanceDto {
  @ApiProperty({ nullable: true, format: 'uuid' }) teacherId: string | null;
  @ApiProperty() teacherName: string;
  @ApiProperty() scheduledLessons: number;
  @ApiProperty() completedLessons: number;
  @ApiProperty() completedHours: number;
  @ApiProperty() publishedLessonRecords: number;
  @ApiProperty() confirmedAttendance: number;
}

export class DashboardDrilldownDto {
  @ApiProperty() metric: string;
  @ApiProperty() label: string;
  @ApiProperty() source: string;
  @ApiProperty() path: string;
}

export class FusionDashboardDto {
  @ApiProperty({ enum: ['administrator', 'teacher', 'student', 'parent'] }) role: string;
  @ApiProperty() scopeLabel: string;
  @ApiProperty({ format: 'date-time' }) from: Date;
  @ApiProperty({ format: 'date-time' }) to: Date;
  @ApiProperty({ type: () => FusionAssessmentMetricsDto }) assessment: FusionAssessmentMetricsDto;
  @ApiProperty({ type: () => FusionAcademicMetricsDto }) academic: FusionAcademicMetricsDto;
  @ApiProperty({ type: () => [FusionRecentExamDto] }) recentExams: FusionRecentExamDto[];
  @ApiProperty({ type: () => [TeacherPerformanceDto] }) teacherPerformance: TeacherPerformanceDto[];
  @ApiProperty({ type: () => [DashboardDrilldownDto] }) drilldowns: DashboardDrilldownDto[];
}
