import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  ApiBinaryResponse,
  ApiCreatedRecordResponse,
  ApiRecordPageResponse,
} from '../../common/dto/api-response.dto';
import { BatchExportActionDto } from './dto/batch-export-action.dto';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportTaskCommandUseCases, ExportTaskQueryUseCases } from './exports.use-cases';
import { createReadStream } from 'node:fs';

@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly queries: ExportTaskQueryUseCases,
    private readonly commands: ExportTaskCommandUseCases,
  ) {}

  @Get()
  @ApiRecordPageResponse()
  @Permissions('export:task:read')
  list(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.queries.list(query, user);
  }

  @Post()
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  create(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.commands.create(dto, user);
  }

  @Get('download-audits')
  @ApiRecordPageResponse()
  @Permissions('export:task:read')
  downloadAudits(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.queries.downloadAudits(query, user);
  }

  @Post('batch/retry')
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  retryMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.commands.retryMany(dto.ids, user);
  }

  @Post(':id/retry')
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  retry(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.commands.retry(id, user);
  }

  @Post('batch/cancel')
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  cancelMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.commands.cancelMany(dto.ids, user);
  }

  @Post(':id/cancel')
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.commands.cancel(id, user);
  }

  @Post('maintenance/cleanup-expired')
  @ApiCreatedRecordResponse()
  @Permissions('export:task:create')
  cleanupExpired() {
    return this.commands.cleanupExpiredTasks();
  }

  @Post('student/wrong-questions')
  @ApiCreatedRecordResponse()
  createWrongQuestionExport(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.commands.createWrongQuestionExport(dto, user);
  }

  @Get(':id/download')
  @ApiBinaryResponse()
  @Permissions('export:file:download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: any,
  ) {
    const file = await this.queries.download(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }
}
