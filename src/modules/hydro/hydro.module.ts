import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataScopeModule } from '../data-scope/data-scope.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HydroController } from './hydro.controller';
import { HydroContext } from './hydro.context';
import {
  HydroAccountUseCases,
  HydroPlatformUseCases,
  HydroPollingWorker,
  HydroProblemUseCases,
  HydroSubmissionUseCases,
  HydroSummaryUseCases,
  HydroTaskUseCases,
} from './hydro.use-cases';

@Module({
  imports: [PrismaModule, AuditModule, DataScopeModule],
  controllers: [HydroController],
  providers: [
    HydroContext,
    HydroPlatformUseCases,
    HydroProblemUseCases,
    HydroTaskUseCases,
    HydroAccountUseCases,
    HydroSubmissionUseCases,
    HydroSummaryUseCases,
    HydroPollingWorker,
  ],
})
export class HydroModule {}
