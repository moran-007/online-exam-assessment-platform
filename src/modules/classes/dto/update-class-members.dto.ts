import { IsArray, IsUUID } from 'class-validator';

export class UpdateClassMembersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];
}
