import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiConfigUseCases } from './ai-config.use-cases';
import { AiProviderGateway } from './ai-provider.gateway';
import { AiController } from './ai.controller';

@Module({
  imports: [AuditModule],
  controllers: [AiController],
  providers: [AiProviderGateway, AiConfigUseCases],
})
export class AiModule {}
