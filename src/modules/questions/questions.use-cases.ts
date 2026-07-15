import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckQuestionAnswerDto } from './dto/check-question-answer.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { checkAnswer } from './questions-answer.operations';
import { checkDuplicates } from './questions-duplicate.operations';
import { excelImportTemplate, importFromExcel } from './questions-import.operations';
import { detail, list, publicDetail, publicList } from './questions-read.operations';
import { buildSnapshot } from './questions-snapshot.operations';
import {
  bulkDelete,
  bulkUpdateStatus,
  create,
  deleteImpact,
  publish,
  remove,
  update,
} from './questions-write.operations';
import { QuestionsContext } from './questions.context';

@Injectable()
export class QuestionReadUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  list(query: QueryQuestionDto) { return list(this.ctx, query); }
  publicList(query: QueryQuestionDto) { return publicList(this.ctx, query); }
  publicDetail(id: string) { return publicDetail(this.ctx, id); }
  detail(id: string) { return detail(this.ctx, id); }
}

@Injectable()
export class QuestionWriteUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  create(dto: CreateQuestionDto, userId: string) { return create(this.ctx, dto, userId); }
  update(id: string, dto: UpdateQuestionDto, userId: string) { return update(this.ctx, id, dto, userId); }
  publish(id: string, userId: string) { return publish(this.ctx, id, userId); }
  remove(id: string, userId: string) { return remove(this.ctx, id, userId); }
  deleteImpact(id: string) { return deleteImpact(this.ctx, id); }
  bulkDelete(ids: string[], userId: string) { return bulkDelete(this.ctx, ids, userId); }
  bulkUpdateStatus(ids: string[], status: string, userId: string) {
    return bulkUpdateStatus(this.ctx, ids, status, userId);
  }
}

@Injectable()
export class QuestionImportUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  excelImportTemplate() { return excelImportTemplate(this.ctx); }
  importFromExcel(
    file: { buffer: Buffer; originalname?: string },
    options: { publish: boolean; skipDuplicates: boolean },
    userId: string,
  ) {
    return importFromExcel(this.ctx, file, options, userId);
  }
}

@Injectable()
export class QuestionDuplicateUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  checkDuplicates(questions: unknown[] = []) { return checkDuplicates(this.ctx, questions); }
}

@Injectable()
export class QuestionAnswerUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  checkAnswer(id: string, dto: CheckQuestionAnswerDto, userId: string) {
    return checkAnswer(this.ctx, id, dto, userId);
  }
}

@Injectable()
export class QuestionSnapshotUseCases {
  constructor(private readonly ctx: QuestionsContext) {}

  buildSnapshot(tx: Prisma.TransactionClient | PrismaService, questionId: string): Promise<Prisma.InputJsonObject> {
    return buildSnapshot(this.ctx, tx, questionId);
  }
}
