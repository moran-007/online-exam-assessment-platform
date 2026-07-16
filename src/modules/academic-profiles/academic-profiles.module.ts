import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AcademicProfilesController } from './academic-profiles.controller';
import { AcademicProfilesService } from './academic-profiles.service';

@Module({
  imports: [AuditModule],
  controllers: [AcademicProfilesController],
  providers: [AcademicProfilesService],
  exports: [AcademicProfilesService],
})
export class AcademicProfilesModule {}
