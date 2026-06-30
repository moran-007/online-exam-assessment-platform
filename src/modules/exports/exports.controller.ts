import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BatchExportActionDto } from './dto/batch-export-action.dto';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportsService } from './exports.service';

@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  @Permissions('exam:result:export')
  list(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.list(query, user);
  }

  @Post()
  @Permissions('exam:result:export')
  create(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.create(dto, user);
  }

  @Get('download-audits')
  @Permissions('exam:result:export')
  downloadAudits(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.downloadAudits(query, user);
  }

  @Post('batch/retry')
  @Permissions('exam:result:export')
  retryMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.retryMany(dto.ids, user);
  }

  @Post(':id/retry')
  @Permissions('exam:result:export')
  retry(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.retry(id, user);
  }

  @Post('batch/cancel')
  @Permissions('exam:result:export')
  cancelMany(@Body() dto: BatchExportActionDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.cancelMany(dto.ids, user);
  }

  @Post(':id/cancel')
  @Permissions('exam:result:export')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.cancel(id, user);
  }

  @Post('maintenance/cleanup-expired')
  @Permissions('exam:result:export')
  cleanupExpired() {
    return this.exportsService.cleanupExpiredTasks();
  }

  @Post('student/wrong-questions')
  createWrongQuestionExport(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.createWrongQuestionExport(dto, user);
  }

  @Get(':id/download')
  @Permissions('exam:result:export')
  download(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.download(id, user);
  }
}
