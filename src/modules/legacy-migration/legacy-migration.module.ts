import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegacyMigrationController } from './legacy-migration.controller';
import { LegacyMigrationPlanner } from './legacy-migration.planner';
import { LegacyMigrationService } from './legacy-migration.service';
import { LegacyProfileImporter } from './legacy-profile.importer';

@Module({
  imports: [AuditModule],
  controllers: [LegacyMigrationController],
  providers: [LegacyMigrationPlanner, LegacyProfileImporter, LegacyMigrationService],
  exports: [LegacyMigrationService],
})
export class LegacyMigrationModule {}
