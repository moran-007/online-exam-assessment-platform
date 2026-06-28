import { IsIn } from 'class-validator';

export class MovePaperQuestionDto {
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
