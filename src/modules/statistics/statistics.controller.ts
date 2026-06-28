import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { QueryStatisticsDto } from './dto/query-statistics.dto';
import { StatisticsService } from './statistics.service';

@ApiTags('Statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  @Permissions('statistics:read')
  overview(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.overview(query);
  }

  @Get('exams')
  @Permissions('statistics:read')
  exams(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.exams(query);
  }

  @Get('exams/:examId')
  @Permissions('statistics:read')
  examDetail(@Param('examId') examId: string) {
    return this.statisticsService.examDetail(examId);
  }

  @Get('knowledge')
  @Permissions('statistics:read')
  knowledge(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.knowledge(query);
  }

  @Get('classes')
  @Permissions('statistics:read')
  classes(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.classes(query);
  }
}
