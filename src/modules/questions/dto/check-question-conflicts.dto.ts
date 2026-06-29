import { IsArray } from 'class-validator';

export class CheckQuestionConflictsDto {
  @IsArray()
  questions: unknown[];
}
