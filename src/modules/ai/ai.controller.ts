import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AiConfigUseCases } from './ai-config.use-cases';
import {
  AiDeleteResultDto,
  AiProviderConfigResponseDto,
  AiProviderPresetDto,
  AiSummaryResultDto,
  AiTestResultDto,
  CreateAiProviderConfigDto,
  GenerateAiSummaryDto,
  UpdateAiProviderConfigDto,
} from './dto/ai.dto';

@ApiTags('AI')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller('ai')
export class AiController {
  constructor(private readonly useCases: AiConfigUseCases) {}

  @Get('presets')
  @ApiOkResponse({ type: [AiProviderPresetDto] })
  presets() { return this.useCases.presets(); }

  @Get('configurations')
  @ApiOkResponse({ type: [AiProviderConfigResponseDto] })
  configurations() { return this.useCases.list(); }

  @Post('configurations')
  @ApiCreatedResponse({ type: AiProviderConfigResponseDto })
  create(@Body() dto: CreateAiProviderConfigDto, @CurrentUser() user: RequestUser) { return this.useCases.create(dto, user); }

  @Patch('configurations/:id')
  @ApiOkResponse({ type: AiProviderConfigResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateAiProviderConfigDto, @CurrentUser() user: RequestUser) {
    return this.useCases.update(id, dto, user);
  }

  @Delete('configurations/:id')
  @ApiOkResponse({ type: AiDeleteResultDto })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.useCases.remove(id, user); }

  @Post('configurations/:id/test')
  @ApiCreatedResponse({ type: AiTestResultDto })
  test(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.useCases.test(id, user); }

  @Post('summary')
  @ApiCreatedResponse({ type: AiSummaryResultDto })
  summarize(@Body() dto: GenerateAiSummaryDto, @CurrentUser() user: RequestUser) { return this.useCases.summarize(dto, user); }
}
