import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { QueryStatisticsDto } from './dto/query-statistics.dto';
import { StatisticsService } from './statistics.service';

@ApiTags('Statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  @Permissions('statistics:read')
  overview(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.overview(query, user);
  }

  @Get('exams')
  @Permissions('statistics:read')
  exams(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.exams(query, user);
  }

  @Get('exams/:examId')
  @Permissions('statistics:read')
  examDetail(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.statisticsService.examDetail(examId, user);
  }

  @Get('knowledge')
  @Permissions('statistics:read')
  knowledge(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.knowledge(query, user);
  }

  @Get('classes')
  @Permissions('statistics:read')
  classes(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.classes(query, user);
  }

  @Get('wrong-questions')
  @Permissions('statistics:read')
  wrongQuestions(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.wrongQuestions(query, user);
  }
}
