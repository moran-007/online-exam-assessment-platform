import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AttendanceService } from './attendance.service';
import { ConfirmAttendanceDto, CorrectAttendanceDto } from './dto/attendance.dto';

@ApiTags('Academic operations - attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('lesson-sessions/:sessionId/attendance')
  @Permissions('attendance:read')
  list(@Param('sessionId') sessionId: string, @CurrentUser() actor: RequestUser) {
    return this.attendance.listForSession(sessionId, actor);
  }

  @Post('lesson-sessions/:sessionId/attendance/confirm')
  @Permissions('attendance:confirm')
  confirm(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConfirmAttendanceDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.attendance.confirm(sessionId, dto, actor);
  }

  @Patch('attendance-records/:id/correct')
  @Permissions('attendance:correct')
  correct(@Param('id') id: string, @Body() dto: CorrectAttendanceDto, @CurrentUser() actor: RequestUser) {
    return this.attendance.correct(id, dto, actor);
  }
}
