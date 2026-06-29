import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamsService } from './exams.service';

@ApiTags('Exam')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Get()
  @Permissions('exam:read')
  list(@Query() query: QueryExamDto, @CurrentUser() user: RequestUser) {
    return this.examsService.list(query, user);
  }

  @Post()
  @Permissions('exam:create')
  create(@Body() dto: CreateExamDto, @CurrentUser() user: RequestUser) {
    return this.examsService.create(dto, user);
  }

  @Patch('batch/status')
  @Permissions('exam:create')
  bulkUpdateStatus(@Body() dto: BulkUpdateExamStatusDto, @CurrentUser() user: RequestUser) {
    return this.examsService.bulkUpdateStatus(dto, user);
  }

  @Get(':id')
  @Permissions('exam:read')
  detail(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.examsService.detail(id, user);
  }

  @Patch(':id')
  @Permissions('exam:create')
  update(@Param('id') id: string, @Body() dto: UpdateExamDto, @CurrentUser() user: RequestUser) {
    return this.examsService.update(id, dto, user);
  }

  @Post(':id/publish')
  @Permissions('exam:publish')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.examsService.publish(id, user);
  }

  @Post(':id/unpublish')
  @Permissions('exam:publish')
  unpublish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.examsService.unpublish(id, user);
  }

  @Delete(':id')
  @Permissions('exam:create')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.examsService.remove(id, user);
  }

  @Get(':id/results')
  @Permissions('exam:result:read')
  results(@Param('id') id: string, @Query() query: QueryExamDto, @CurrentUser() user: RequestUser) {
    return this.examsService.results(id, query, user);
  }

  @Get(':id/statistics')
  @Permissions('exam:result:read')
  statistics(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.examsService.statistics(id, user);
  }
}
