import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  AddWrongQuestionDto,
  BatchWrongQuestionDto,
  GenerateWrongQuestionPaperDto,
  QueryStudentExamDto,
  QueryStudentPaperDto,
  QueryWrongQuestionDto,
  RecordWrongQuestionPracticeDto,
  SaveAnswerDto,
  SaveAnswersDto,
  UpdateWrongQuestionStatusDto,
} from './dto/save-answer.dto';
import {
  enterExam,
  enterExamAsStudent,
  examRanking,
  getAttemptAsStudent,
  myExams,
  readExamAnnouncement,
  resultAsStudent,
  saveAnswersAsStudent,
  submitAsStudent,
} from './student-exam-query.operations';
import { getAttempt } from './student-exam-entry.operations';
import { saveAnswer, saveAnswers } from './student-answer-save.operations';
import { submit } from './student-attempt-submit.operations';
import { result } from './student-attempt-result.operations';
import {
  addWrongQuestion,
  addWrongQuestions,
  recordWrongQuestionPractice,
  updateWrongQuestionStatus,
  wrongQuestionEvents,
  wrongQuestions,
} from './student-wrong-question.operations';
import { generateWrongQuestionPaper, wrongQuestionInsights } from './student-wrong-analysis.operations';
import { previewStudentPaper, studentPapers } from './student-paper-query.operations';
import { StudentContext } from './student.context';

@Injectable()
export class StudentExamUseCases {
  constructor(private readonly ctx: StudentContext) {}

  myExams(user: RequestUser, query: QueryStudentExamDto) {
    return myExams(this.ctx, user, query);
  }

  examRanking(examId: string, user: RequestUser) {
    return examRanking(this.ctx, examId, user);
  }

  readExamAnnouncement(examId: string, user: RequestUser) {
    return readExamAnnouncement(this.ctx, examId, user);
  }

  enterExam(examId: string, user: RequestUser) {
    return enterExam(this.ctx, examId, user);
  }

  enterExamAsStudent(examId: string, studentId: string, operator: RequestUser) {
    return enterExamAsStudent(this.ctx, examId, studentId, operator);
  }
}

@Injectable()
export class StudentAttemptUseCases {
  constructor(private readonly ctx: StudentContext) {}

  getAttempt(attemptId: string, user: RequestUser) {
    return getAttempt(this.ctx, attemptId, user);
  }

  getAttemptAsStudent(attemptId: string, studentId: string, operator: RequestUser) {
    return getAttemptAsStudent(this.ctx, attemptId, studentId, operator);
  }

  async saveAnswer(attemptId: string, dto: SaveAnswerDto, user: RequestUser) {
    return this.track('autosave', () => saveAnswer(this.ctx, attemptId, dto, user));
  }

  async saveAnswers(attemptId: string, dto: SaveAnswersDto, user: RequestUser) {
    const result = await this.track('autosave', () => saveAnswers(this.ctx, attemptId, dto, user));
    if (result.finalized) this.ctx.metrics.recordExamOperation('forced_finalize', 'success');
    return result;
  }

  async saveAnswersAsStudent(attemptId: string, studentId: string, dto: SaveAnswersDto, operator: RequestUser) {
    return this.track('autosave', () => saveAnswersAsStudent(this.ctx, attemptId, studentId, dto, operator));
  }

  async submit(attemptId: string, user: RequestUser) {
    return this.track('submit', () => submit(this.ctx, attemptId, user));
  }

  submitAsStudent(attemptId: string, studentId: string, operator: RequestUser) {
    return submitAsStudent(this.ctx, attemptId, studentId, operator);
  }

  result(attemptId: string, user: RequestUser) {
    return result(this.ctx, attemptId, user);
  }

  resultAsStudent(attemptId: string, studentId: string) {
    return resultAsStudent(this.ctx, attemptId, studentId);
  }

  private async track<T>(operation: 'autosave' | 'submit', execute: () => Promise<T>) {
    try {
      const result = await execute();
      this.ctx.metrics.recordExamOperation(operation, 'success');
      return result;
    } catch (error) {
      this.ctx.metrics.recordExamOperation(operation, 'failed');
      throw error;
    }
  }
}

@Injectable()
export class StudentWrongQuestionUseCases {
  constructor(private readonly ctx: StudentContext) {}

  wrongQuestions(user: RequestUser, query: QueryWrongQuestionDto) {
    return wrongQuestions(this.ctx, user, query);
  }

  wrongQuestionInsights(user: RequestUser) {
    return wrongQuestionInsights(this.ctx, user);
  }

  wrongQuestionEvents(user: RequestUser, questionId: string) {
    return wrongQuestionEvents(this.ctx, user, questionId);
  }

  addWrongQuestion(user: RequestUser, dto: AddWrongQuestionDto) {
    return addWrongQuestion(this.ctx, user, dto);
  }

  addWrongQuestions(user: RequestUser, dto: BatchWrongQuestionDto) {
    return addWrongQuestions(this.ctx, user, dto);
  }

  updateWrongQuestionStatus(user: RequestUser, questionId: string, dto: UpdateWrongQuestionStatusDto) {
    return updateWrongQuestionStatus(this.ctx, user, questionId, dto);
  }

  recordWrongQuestionPractice(user: RequestUser, questionId: string, dto: RecordWrongQuestionPracticeDto) {
    return recordWrongQuestionPractice(this.ctx, user, questionId, dto);
  }

  generateWrongQuestionPaper(user: RequestUser, dto: GenerateWrongQuestionPaperDto) {
    return generateWrongQuestionPaper(this.ctx, user, dto);
  }
}

@Injectable()
export class StudentPaperUseCases {
  constructor(private readonly ctx: StudentContext) {}

  studentPapers(user: RequestUser, query: QueryStudentPaperDto) {
    return studentPapers(this.ctx, user, query);
  }

  previewStudentPaper(user: RequestUser, paperId: string) {
    return previewStudentPaper(this.ctx, user, paperId);
  }
}
