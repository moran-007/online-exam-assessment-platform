import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuestionsModule } from '../questions/questions.module';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';

@Module({
  imports: [AuditModule, QuestionsModule],
  controllers: [StudentController],
  providers: [StudentService],
})
export class StudentModule {}
