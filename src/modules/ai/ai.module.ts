import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiConfigUseCases } from './ai-config.use-cases';
import { AiGenerationUseCases } from './ai-generation.use-cases';
import { AiProviderGateway } from './ai-provider.gateway';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiController } from './ai.controller';
import { AiTokenUsageService } from './ai-token-usage.service';
import { SummaryOutputValidator } from './schemas/summary-output.validator';

@Module({
  imports: [AuditModule],
  controllers: [AiController],
  providers: [
    AiProviderGateway,
    AiProviderCapabilityRegistry,
    AiTokenUsageService,
    SummaryOutputValidator,
    AiConfigUseCases,
    AiGenerationUseCases,
  ],
  exports: [AiProviderGateway, AiProviderCapabilityRegistry, AiTokenUsageService, SummaryOutputValidator],
})
export class AiModule {}
