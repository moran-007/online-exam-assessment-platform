import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class SaveAnswerDto {
  @IsUUID()
  questionId: string;

  @IsObject()
  answer: Record<string, unknown>;
}

export class SaveAnswersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveAnswerDto)
  answers: SaveAnswerDto[];
}

export class SubmitAttemptDto {
  @IsOptional()
  confirm = true;
}

export class QueryStudentExamDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class QueryStudentPaperDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;
}

export class SimulateStudentDto {
  @IsUUID()
  studentId: string;
}

export class SimulateSaveAnswersDto extends SaveAnswersDto {
  @IsUUID()
  studentId: string;
}

export class AddWrongQuestionDto {
  @IsUUID()
  questionId: string;
}

export class BatchWrongQuestionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddWrongQuestionDto)
  items: AddWrongQuestionDto[];
}

export class UpdateWrongQuestionStatusDto {
  @IsIn(['unmastered', 'reviewing', 'mastered', 'ignored'])
  masteryStatus: string;
}

export class RecordWrongQuestionPracticeDto {
  @IsOptional()
  @IsObject()
  answer?: Record<string, unknown>;

  @IsBoolean()
  isCorrect: boolean;

  @IsOptional()
  @Type(() => Number)
  score?: number;

  @IsOptional()
  @Type(() => Number)
  totalScore?: number;
}

export class GenerateWrongQuestionPaperDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  questionIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @IsBoolean()
  random?: boolean;
}
