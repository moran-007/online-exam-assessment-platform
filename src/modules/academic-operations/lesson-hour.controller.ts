import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateLessonHourAdjustmentDto, QueryLessonHourDto, ReconcileLessonHoursDto } from './dto/lesson-hour.dto';
import { LessonHourService } from './lesson-hour.service';

@ApiTags('Academic operations - lesson hours')
@ApiBearerAuth()
@Controller('lesson-hours')
export class LessonHourController {
  constructor(private readonly hours: LessonHourService) {}

  @Get('ledger')
  @Permissions('lesson-hour:read')
  ledger(@Query() query: QueryLessonHourDto, @CurrentUser() actor: RequestUser) {
    return this.hours.listLedger(query, actor);
  }

  @Get('balances')
  @Permissions('lesson-hour:read')
  balances(@Query() query: QueryLessonHourDto, @CurrentUser() actor: RequestUser) {
    return this.hours.balances(query, actor);
  }

  @Post('adjustments')
  @Permissions('lesson-hour:adjust')
  adjust(@Body() dto: CreateLessonHourAdjustmentDto, @CurrentUser() actor: RequestUser) {
    return this.hours.adjust(dto, actor);
  }

  @Post('reconcile')
  @Permissions('lesson-hour:reconcile')
  reconcile(@Body() dto: ReconcileLessonHoursDto, @CurrentUser() actor: RequestUser) {
    return this.hours.reconcile(dto, actor);
  }
}
