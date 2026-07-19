import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { QueryStatisticsDto } from './dto/query-statistics.dto';
import { FusionDashboardDto, FusionDashboardQueryDto } from './dto/fusion-dashboard.dto';
import {
  ClassPerformanceDto,
  ExamPerformancePageDto,
  ExamStatisticsDetailDto,
  KnowledgePerformanceDto,
  KnowledgeTrendPointDto,
  QuestionDiagnosticDto,
  ScoreDistributionDto,
  StatisticsOverviewDto,
  WrongQuestionStatisticDto,
} from './dto/statistics-response.dto';
import { StatisticsService } from './statistics.service';

@ApiTags('Statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('fusion-dashboard')
  @Permissions('dashboard:read')
  @ApiOkResponse({ type: FusionDashboardDto })
  fusionDashboard(@Query() query: FusionDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.fusionDashboard(query, user);
  }

  @Get('overview')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: StatisticsOverviewDto })
  overview(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.overview(query, user);
  }

  @Get('exams')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: ExamPerformancePageDto })
  exams(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.exams(query, user);
  }

  @Get('score-distribution')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: ScoreDistributionDto })
  scoreDistribution(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.scoreDistribution(query, user);
  }

  @Get('class-comparison')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [ClassPerformanceDto] })
  classComparison(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.classComparison(query, user);
  }

  @Get('exams/:examId')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: ExamStatisticsDetailDto })
  examDetail(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.statisticsService.examDetail(examId, user);
  }

  @Get('knowledge')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [KnowledgePerformanceDto] })
  knowledge(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.knowledge(query, user);
  }

  @Get('knowledge-trend')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [KnowledgeTrendPointDto] })
  knowledgeTrend(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.knowledgeTrend(query, user);
  }

  @Get('classes')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [ClassPerformanceDto] })
  classes(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.classes(query, user);
  }

  @Get('question-diagnostics')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [QuestionDiagnosticDto] })
  questionDiagnostics(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.questionDiagnostics(query, user);
  }

  @Get('wrong-questions')
  @Permissions('statistics:read')
  @ApiOkResponse({ type: [WrongQuestionStatisticDto] })
  wrongQuestions(@Query() query: QueryStatisticsDto, @CurrentUser() user: RequestUser) {
    return this.statisticsService.wrongQuestions(query, user);
  }
}
