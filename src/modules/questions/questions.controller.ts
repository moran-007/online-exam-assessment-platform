import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
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

  @Get('import-template')
  @Permissions('question:read')
  async downloadImportTemplate(@Res() res: any) {
    const buffer = await this.questionsService.excelImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="question-import-template.xlsx"');
    res.send(buffer);
  }

  @Post('import')
  @Permissions('question:create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        publish: { type: 'boolean', default: false },
        skipDuplicates: { type: 'boolean', default: true },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  importExcel(
    @UploadedFile() file: any,
    @Body() body: { publish?: unknown; skipDuplicates?: unknown },
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    return this.questionsService.importFromExcel(
      file,
      {
        publish: this.formBoolean(body.publish, false),
        skipDuplicates: this.formBoolean(body.skipDuplicates, true),
      },
      user.id,
    );
  }

  @Post('batch/delete')
  @Permissions('question:delete')
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
  @Permissions('question:publish')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.questionsService.publish(id, user.id);
  }

  @Delete(':id')
  @Permissions('question:delete')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.questionsService.remove(id, user.id);
  }

  private formBoolean(value: unknown, defaultValue: boolean) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on', '是'].includes(String(value).trim().toLowerCase());
  }
}
