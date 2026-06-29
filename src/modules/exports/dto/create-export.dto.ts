import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateExportDto {
  @IsString()
  @IsIn(['exam_results', 'grading', 'question_bank', 'papers', 'paper_document', 'wrong_questions', 'classes', 'statistics'])
  type: string;

  @IsOptional()
  @IsString()
  @IsIn(['csv', 'json', 'pdf', 'docx', 'zip'])
  format?: string;

  @IsOptional()
  @IsString()
  @IsIn(['student', 'teacher', 'answer_book'])
  template?: string;

  @IsOptional()
  @IsUUID()
  paperId?: string;

  @IsOptional()
  @IsUUID()
  examId?: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  questionIds?: string[];

  @IsOptional()
  @IsBoolean()
  includeAnswers?: boolean;

  @IsOptional()
  @IsBoolean()
  includeAnalysis?: boolean;

  @IsOptional()
  @IsBoolean()
  includeWrongInfo?: boolean;
}
