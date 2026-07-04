import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BatchExportActionDto } from './dto/batch-export-action.dto';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportsService } from './exports.service';
import { createReadStream } from 'node:fs';

@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  @Permissions('export:task:read')
  list(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.list(query, user);
  }

  @Post()
  @Permissions('export:task:create')
  create(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.create(dto, user);
  }

  @Get('download-audits')
  @Permissions('export:task:read')
  downloadAudits(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.downloadAudits(query, user);
  }

  @Post('batch/retry')
  @Permissions('export:task:create')
  retryMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.retryMany(dto.ids, user);
  }

  @Post(':id/retry')
  @Permissions('export:task:create')
  retry(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.retry(id, user);
  }

  @Post('batch/cancel')
  @Permissions('export:task:create')
  cancelMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.cancelMany(dto.ids, user);
  }

  @Post(':id/cancel')
  @Permissions('export:task:create')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.cancel(id, user);
  }

  @Post('maintenance/cleanup-expired')
  @Permissions('export:task:create')
  cleanupExpired() {
    return this.exportsService.cleanupExpiredTasks();
  }

  @Post('student/wrong-questions')
  createWrongQuestionExport(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.createWrongQuestionExport(dto, user);
  }

  @Get(':id/download')
  @Permissions('export:file:download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: any,
  ) {
    const file = await this.exportsService.download(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }
}
