import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  ApiCreatedRecordResponse,
  ApiRecordPageResponse,
  ApiRecordResponse,
} from '../../common/dto/api-response.dto';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { RemindExamAnnouncementDto } from './dto/remind-exam-announcement.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import {
  ExamAnnouncementUseCases,
  ExamLifecycleUseCases,
  ExamQueryUseCases,
  ExamWriteUseCases,
} from './exams.use-cases';

@ApiTags('Exam')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly queries: ExamQueryUseCases,
    private readonly writes: ExamWriteUseCases,
    private readonly lifecycle: ExamLifecycleUseCases,
    private readonly announcements: ExamAnnouncementUseCases,
  ) {}

  @Get()
  @ApiRecordPageResponse()
  @Permissions('exam:read')
  list(@Query() query: QueryExamDto, @CurrentUser() user: RequestUser) {
    return this.queries.list(query, user);
  }

  @Post()
  @ApiCreatedRecordResponse()
  @Permissions('exam:create')
  create(@Body() dto: CreateExamDto, @CurrentUser() user: RequestUser) {
    return this.writes.create(dto, user);
  }

  @Patch('batch/status')
  @ApiRecordResponse()
  @Permissions('exam:update')
  bulkUpdateStatus(@Body() dto: BulkUpdateExamStatusDto, @CurrentUser() user: RequestUser) {
    return this.lifecycle.bulkUpdateStatus(dto, user);
  }

  @Get(':id/announcement-reads')
  @ApiRecordResponse()
  @Permissions('exam:result:read')
  announcementReads(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcements.announcementReads(id, user);
  }

  @Post(':id/announcement-reads/remind')
  @ApiCreatedRecordResponse()
  @Permissions('exam:result:read')
  remindAnnouncementUnread(
    @Param('id') id: string,
    @Body() body: RemindExamAnnouncementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.announcements.remindAnnouncementUnread(id, body?.content, user);
  }

  @Get(':id')
  @ApiRecordResponse()
  @Permissions('exam:read')
  detail(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.queries.detail(id, user);
  }

  @Patch(':id')
  @ApiRecordResponse()
  @Permissions('exam:update')
  update(@Param('id') id: string, @Body() dto: UpdateExamDto, @CurrentUser() user: RequestUser) {
    return this.writes.update(id, dto, user);
  }

  @Post(':id/publish')
  @ApiCreatedRecordResponse()
  @Permissions('exam:publish')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.publish(id, user);
  }

  @Post(':id/unpublish')
  @ApiCreatedRecordResponse()
  @Permissions('exam:publish')
  unpublish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.unpublish(id, user);
  }

  @Post(':id/start')
  @ApiCreatedRecordResponse()
  @Permissions('exam:publish')
  start(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.start(id, user);
  }

  @Post(':id/end')
  @ApiCreatedRecordResponse()
  @Permissions('exam:publish')
  end(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.end(id, user);
  }

  @Delete(':id')
  @ApiRecordResponse()
  @Permissions('exam:delete')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.writes.remove(id, user);
  }

  @Get(':id/results')
  @ApiRecordPageResponse()
  @Permissions('exam:result:read')
  results(@Param('id') id: string, @Query() query: QueryExamDto, @CurrentUser() user: RequestUser) {
    return this.queries.results(id, query, user);
  }

  @Get(':id/statistics')
  @ApiRecordResponse()
  @Permissions('exam:result:read')
  statistics(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.queries.statistics(id, user);
  }
}
