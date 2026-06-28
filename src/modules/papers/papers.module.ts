import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuestionsModule } from '../questions/questions.module';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [AuditModule, QuestionsModule],
  controllers: [PapersController],
  providers: [PapersService],
  exports: [PapersService],
})
export class PapersModule {}
