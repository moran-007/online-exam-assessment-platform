import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AiSummaryPresetUseCases } from './ai-summary-preset.use-cases';
import { AiSummaryPresetResponseDto, UpdateAiSummaryPresetDto } from './dto/ai-summary-preset.dto';

@ApiTags('AI Summary Preset')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('ai/summary-presets')
export class AiSummaryPresetController {
  constructor(private readonly useCases: AiSummaryPresetUseCases) {}

  @Get()
  @ApiOkResponse({ type: [AiSummaryPresetResponseDto] })
  list() { return this.useCases.list(); }

  @Patch(':id')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: AiSummaryPresetResponseDto })
  revise(
    @Param('id') id: string,
    @Body() dto: UpdateAiSummaryPresetDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.useCases.revise(id, dto, user);
  }

  @Post(':id/activate')
  @ApiCreatedResponse({ type: AiSummaryPresetResponseDto })
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.useCases.activate(id, user);
  }
}
