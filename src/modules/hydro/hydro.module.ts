import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataScopeModule } from '../data-scope/data-scope.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HydroController } from './hydro.controller';
import { HydroService } from './hydro.service';

@Module({
  imports: [PrismaModule, AuditModule, DataScopeModule],
  controllers: [HydroController],
  providers: [HydroService],
  exports: [HydroService],
})
export class HydroModule {}
