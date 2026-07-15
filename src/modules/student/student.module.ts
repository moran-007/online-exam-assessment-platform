import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuestionsModule } from '../questions/questions.module';
import { StudentController } from './student.controller';
import { StudentContext } from './student.context';
import {
  StudentAttemptUseCases,
  StudentExamUseCases,
  StudentPaperUseCases,
  StudentWrongQuestionUseCases,
} from './student.use-cases';

@Module({
  imports: [AuditModule, QuestionsModule],
  controllers: [StudentController],
  providers: [
    StudentContext,
    StudentExamUseCases,
    StudentAttemptUseCases,
    StudentWrongQuestionUseCases,
    StudentPaperUseCases,
  ],
})
export class StudentModule {}
