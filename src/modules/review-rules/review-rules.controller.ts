import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ReviewReminderRuleDto, UpdateReviewReminderRuleDto } from './dto/review-reminder-rule.dto';
import { ReviewRulesService } from './review-rules.service';

@ApiTags('ReviewRule')
@ApiBearerAuth()
@Controller('review-rules')
export class ReviewRulesController {
  constructor(private readonly reviewRulesService: ReviewRulesService) {}

  @Get()
  @Permissions('statistics:read')
  list(@Query() query: { courseId?: string; classId?: string; knowledgePointId?: string }) {
    return this.reviewRulesService.list(query);
  }

  @Post()
  @Permissions('statistics:read')
  create(@Body() dto: ReviewReminderRuleDto, @CurrentUser() user: RequestUser) {
    return this.reviewRulesService.create(dto, user);
  }

  @Patch(':id')
  @Permissions('statistics:read')
  update(@Param('id') id: string, @Body() dto: UpdateReviewReminderRuleDto, @CurrentUser() user: RequestUser) {
    return this.reviewRulesService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions('statistics:read')
  remove(@Param('id') id: string) {
    return this.reviewRulesService.remove(id);
  }
}
