import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { QueryGradingDto } from './dto/query-grading.dto';
import { GradingService } from './grading.service';

@ApiTags('Grading')
@ApiBearerAuth()
@Controller('grading')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  @Get('answers')
  @Permissions('grading:read')
  list(@Query() query: QueryGradingDto) {
    return this.gradingService.list(query);
  }

  @Get('attempts/:attemptId')
  @Permissions('grading:read')
  attemptDetail(@Param('attemptId') attemptId: string) {
    return this.gradingService.attemptDetail(attemptId);
  }

  @Patch('answers/:answerRecordId')
  @Permissions('grading:update')
  gradeAnswer(
    @Param('answerRecordId') answerRecordId: string,
    @Body() dto: GradeAnswerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.gradingService.gradeAnswer(answerRecordId, dto, user.id);
  }
}
