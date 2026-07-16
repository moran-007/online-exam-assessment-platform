import { ApiProperty } from '@nestjs/swagger';

export class AiDataCoverageDto {
  @ApiProperty({ nullable: true }) from: string | null;
  @ApiProperty({ nullable: true }) to: string | null;
  @ApiProperty({ type: [String] }) includes: string[];
  @ApiProperty({ type: [String] }) excludes: string[];
}

export class AiEvidenceRefDto {
  @ApiProperty() refId: string;
  @ApiProperty() sourceType: string;
  @ApiProperty({ format: 'uuid' }) sourceId: string;
  @ApiProperty() metric: string;
  @ApiProperty() path: string;
  @ApiProperty({ nullable: true }) value: string | number | boolean | null;
  @ApiProperty({ nullable: true }) unit: string | null;
  @ApiProperty({ format: 'date-time' }) capturedAt: string;
}

export class AiEvidencedNumberDto {
  @ApiProperty({ nullable: true }) value: number | null;
  @ApiProperty() evidenceRef: string;
}

export class AiExamContextDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ format: 'uuid' }) courseId: string;
  @ApiProperty() courseName: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) classId: string | null;
  @ApiProperty({ nullable: true }) className: string | null;
}

export class AiExamParticipationDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) eligible: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submitted: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) graded: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submissionRate: AiEvidencedNumberDto;
}

export class AiExamScoresDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) fullScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) average: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) median: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) minimum: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) maximum: AiEvidencedNumberDto;
}

export class AiExamDistributionDto {
  @ApiProperty() label: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) count: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) rate: AiEvidencedNumberDto;
}

export class AiExamQuestionFactDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) averageScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) discrimination: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) anomalyCount: AiEvidencedNumberDto;
}

export class AiKnowledgePointFactDto {
  @ApiProperty({ format: 'uuid' }) knowledgePointId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
}

export class ExamSummaryDatasetPreviewDto {
  @ApiProperty() inputHash: string;
  @ApiProperty() datasetVersion: string;
  @ApiProperty({ format: 'date-time' }) generatedAt: string;
  @ApiProperty({ type: () => AiDataCoverageDto }) dataCoverage: AiDataCoverageDto;
  @ApiProperty({ type: () => AiExamContextDto }) exam: AiExamContextDto;
  @ApiProperty({ type: () => AiExamParticipationDto }) participation: AiExamParticipationDto;
  @ApiProperty({ type: () => AiExamScoresDto }) scores: AiExamScoresDto;
  @ApiProperty({ type: () => [AiExamDistributionDto] }) distribution: AiExamDistributionDto[];
  @ApiProperty({ type: () => [AiExamQuestionFactDto] }) questions: AiExamQuestionFactDto[];
  @ApiProperty({ type: () => [AiKnowledgePointFactDto] }) knowledgePoints: AiKnowledgePointFactDto[];
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
}
