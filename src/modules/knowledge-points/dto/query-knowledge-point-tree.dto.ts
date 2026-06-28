import { IsUUID } from 'class-validator';

export class QueryKnowledgePointTreeDto {
  @IsUUID()
  courseId: string;
}
