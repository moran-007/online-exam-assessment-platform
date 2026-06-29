import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BulkQuestionActionDto, BulkQuestionStatusDto } from './dto/bulk-question-action.dto';
import { CheckQuestionAnswerDto } from './dto/check-question-answer.dto';
import { CheckQuestionConflictsDto } from './dto/check-question-conflicts.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionsService } from './questions.service';

@ApiTags('Question')
@ApiBearerAuth()
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  @Permissions('question:read')
  list(@Query() query: QueryQuestionDto) {
    return this.questionsService.list(query);
  }

  @Public()
  @Get('public/list')
  publicList(@Query() query: QueryQuestionDto) {
    return this.questionsService.publicList(query);
  }

  @Public()
  @Get('public/:id')
  publicDetail(@Param('id') id: string) {
    return this.questionsService.publicDetail(id);
  }

  @Post()
  @Permissions('question:create')
  create(@Body() dto: CreateQuestionDto, @CurrentUser() user: RequestUser) {
    return this.questionsService.create(dto, user.id);
  }

  @Post('duplicate-check')
  @Permissions('question:read')
  checkDuplicates(@Body() dto: CheckQuestionConflictsDto) {
    return this.questionsService.checkDuplicates(dto.questions);
  }

  @Post('batch/delete')
  @Permissions('question:update')
  bulkDelete(@Body() dto: BulkQuestionActionDto, @CurrentUser() user: RequestUser) {
    return this.questionsService.bulkDelete(dto.ids, user.id);
  }

  @Patch('batch/status')
  @Permissions('question:update')
  bulkUpdateStatus(@Body() dto: BulkQuestionStatusDto, @CurrentUser() user: RequestUser) {
    return this.questionsService.bulkUpdateStatus(dto.ids, dto.status, user.id);
  }

  @Get(':id/delete-impact')
  @Permissions('question:read')
  deleteImpact(@Param('id') id: string) {
    return this.questionsService.deleteImpact(id);
  }

  @Get(':id')
  @Permissions('question:read')
  detail(@Param('id') id: string) {
    return this.questionsService.detail(id);
  }

  @Post(':id/check-answer')
  checkAnswer(@Param('id') id: string, @Body() dto: CheckQuestionAnswerDto, @CurrentUser() user: RequestUser) {
    return this.questionsService.checkAnswer(id, dto, user.id);
  }

  @Patch(':id')
  @Permissions('question:update')
  update(@Param('id') id: string, @Body() dto: UpdateQuestionDto, @CurrentUser() user: RequestUser) {
    return this.questionsService.update(id, dto, user.id);
  }

  @Post(':id/publish')
  @Permissions('question:update')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.questionsService.publish(id, user.id);
  }

  @Delete(':id')
  @Permissions('question:update')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.questionsService.remove(id, user.id);
  }
}
