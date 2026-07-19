import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { LearningPortalService } from './learning-portal.service';

@ApiTags('Learning portal')
@ApiBearerAuth()
@Controller('learning-portal')
export class LearningPortalController {
  constructor(private readonly portal: LearningPortalService) {}

  @Get('students')
  @Permissions('lesson-record:read')
  students(@CurrentUser() actor: RequestUser) {
    return this.portal.students(actor);
  }

  @Get('students/:studentId')
  @Permissions('lesson-record:read')
  overview(@Param('studentId') studentId: string, @CurrentUser() actor: RequestUser) {
    return this.portal.overview(studentId, actor);
  }
}

