import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AddPaperQuestionDto } from './dto/add-paper-question.dto';
import { AddPaperQuestionsByTagsDto } from './dto/add-paper-questions-by-tags.dto';
import { CreatePaperDto } from './dto/create-paper.dto';
import { GeneratePaperRuleDto } from './dto/generate-paper-rule.dto';
import { GeneratePaperFromWrongDto } from './dto/generate-paper-from-wrong.dto';
import { MovePaperQuestionDto } from './dto/move-paper-question.dto';
import { QueryPaperDto } from './dto/query-paper.dto';
import { UpdatePaperQuestionDto } from './dto/update-paper-question.dto';
import { UpdatePaperQuestionSnapshotDto } from './dto/update-paper-question-snapshot.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { PapersService } from './papers.service';

@ApiTags('Paper')
@ApiBearerAuth()
@Controller('papers')
export class PapersController {
  constructor(private readonly papersService: PapersService) {}

  @Get()
  @Permissions('paper:read')
  list(@Query() query: QueryPaperDto) {
    return this.papersService.list(query);
  }

  @Post()
  @Permissions('paper:create')
  create(@Body() dto: CreatePaperDto, @CurrentUser() user: RequestUser) {
    return this.papersService.create(dto, user.id);
  }

  @Get(':id')
  @Permissions('paper:read')
  detail(@Param('id') id: string) {
    return this.papersService.detail(id);
  }

  @Patch(':id')
  @Permissions('paper:create')
  update(@Param('id') id: string, @Body() dto: UpdatePaperDto, @CurrentUser() user: RequestUser) {
    return this.papersService.update(id, dto, user.id);
  }

  @Post(':id/copy')
  @Permissions('paper:create')
  copyAsDraft(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.papersService.copyAsDraft(id, user.id);
  }

  @Post(':id/questions')
  @Permissions('paper:create')
  addQuestion(
    @Param('id') id: string,
    @Body() dto: AddPaperQuestionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.addQuestion(id, dto, user.id);
  }

  @Post(':id/questions/by-tags')
  @Permissions('paper:create')
  addQuestionsByTags(
    @Param('id') id: string,
    @Body() dto: AddPaperQuestionsByTagsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.addQuestionsByTags(id, dto, user.id);
  }

  @Delete(':id/questions/:paperQuestionId')
  @Permissions('paper:create')
  removeQuestion(
    @Param('id') id: string,
    @Param('paperQuestionId') paperQuestionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.removeQuestion(id, paperQuestionId, user.id);
  }

  @Patch(':id/questions/:paperQuestionId')
  @Permissions('paper:create')
  updateQuestion(
    @Param('id') id: string,
    @Param('paperQuestionId') paperQuestionId: string,
    @Body() dto: UpdatePaperQuestionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.updateQuestion(id, paperQuestionId, dto, user.id);
  }

  @Patch(':id/questions/:paperQuestionId/snapshot')
  @Permissions('paper:create')
  updateQuestionSnapshot(
    @Param('id') id: string,
    @Param('paperQuestionId') paperQuestionId: string,
    @Body() dto: UpdatePaperQuestionSnapshotDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.updateQuestionSnapshot(id, paperQuestionId, dto, user.id);
  }

  @Post(':id/questions/:paperQuestionId/move')
  @Permissions('paper:create')
  moveQuestion(
    @Param('id') id: string,
    @Param('paperQuestionId') paperQuestionId: string,
    @Body() dto: MovePaperQuestionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.moveQuestion(id, paperQuestionId, dto.direction, user.id);
  }

  @Post('validate-rules')
  @Permissions('paper:create')
  validateRules(@Body() dto: GeneratePaperRuleDto) {
    return this.papersService.validateRules(dto);
  }

  @Post('generate-from-wrong-frequency')
  @Permissions('paper:create')
  generateFromWrongFrequency(@Body() dto: GeneratePaperFromWrongDto, @CurrentUser() user: RequestUser) {
    return this.papersService.generateFromWrongFrequency(dto, user.id);
  }

  @Post(':id/generate-by-rule')
  @Permissions('paper:create')
  generateByRule(
    @Param('id') id: string,
    @Body() dto: GeneratePaperRuleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.papersService.generateByRule(id, dto, user.id);
  }

  @Post(':id/publish')
  @Permissions('paper:publish')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.papersService.publish(id, user.id);
  }

  @Get(':id/preview')
  @Permissions('paper:read')
  preview(@Param('id') id: string) {
    return this.papersService.preview(id);
  }
}
