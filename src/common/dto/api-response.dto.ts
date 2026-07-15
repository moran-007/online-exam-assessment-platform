import { applyDecorators } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ example: 40000 })
  code: number;

  @ApiProperty({ example: '请求参数错误' })
  message: string;

  @ApiProperty({ nullable: true, example: null })
  data: null;
}

export class ApiEnvelopeDto<T = unknown> {
  @ApiProperty({ example: 0 })
  code: number;

  @ApiProperty({ example: 'ok' })
  message: string;

  data: T;
}

export class PageResultDto<T = unknown> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 0 })
  total: number;
}

export class ApiRecordDto {
  @ApiPropertyOptional({ format: 'uuid' })
  id?: string;

  @ApiPropertyOptional()
  status?: string;

  @ApiPropertyOptional({ additionalProperties: true })
  metadata?: Record<string, unknown>;
}

export class ApiRecordPageDto extends PageResultDto<ApiRecordDto> {
  @ApiProperty({ type: () => [ApiRecordDto] })
  declare items: ApiRecordDto[];
}

export const ApiRecordResponse = () => ApiOkResponse({ type: ApiRecordDto });
export const ApiCreatedRecordResponse = () => ApiCreatedResponse({ type: ApiRecordDto });
export const ApiRecordPageResponse = () => ApiOkResponse({ type: ApiRecordPageDto });
export const ApiRecordArrayResponse = () => applyDecorators(
  ApiExtraModels(ApiRecordDto),
  ApiOkResponse({ schema: { type: 'array', items: { $ref: getSchemaPath(ApiRecordDto) } } }),
);
export const ApiCreatedRecordArrayResponse = () => applyDecorators(
  ApiExtraModels(ApiRecordDto),
  ApiCreatedResponse({ schema: { type: 'array', items: { $ref: getSchemaPath(ApiRecordDto) } } }),
);
export const ApiBinaryResponse = (contentType = 'application/octet-stream') => ApiOkResponse({
  content: { [contentType]: { schema: { type: 'string', format: 'binary' } } },
});
