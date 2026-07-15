import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { announcementReads, remindAnnouncementUnread } from './exam-announcement.operations';
import { bulkUpdateStatus, end, publish, start, unpublish } from './exam-lifecycle.operations';
import { detail, list, results, statistics } from './exam-query.operations';
import { create, remove, update } from './exam-write.operations';
import { ExamsContext } from './exams.context';

@Injectable()
export class ExamQueryUseCases {
  constructor(private readonly ctx: ExamsContext) {}

  list(query: QueryExamDto, user: RequestUser) { return list(this.ctx, query, user); }
  detail(id: string, user: RequestUser) { return detail(this.ctx, id, user); }
  results(id: string, query: QueryExamDto, user: RequestUser) { return results(this.ctx, id, query, user); }
  statistics(id: string, user: RequestUser) { return statistics(this.ctx, id, user); }
}

@Injectable()
export class ExamWriteUseCases {
  constructor(private readonly ctx: ExamsContext) {}

  create(dto: CreateExamDto, user: RequestUser) { return create(this.ctx, dto, user); }
  update(id: string, dto: UpdateExamDto, user: RequestUser) { return update(this.ctx, id, dto, user); }
  remove(id: string, user: RequestUser) { return remove(this.ctx, id, user); }
}

@Injectable()
export class ExamLifecycleUseCases {
  constructor(private readonly ctx: ExamsContext) {}

  publish(id: string, user: RequestUser) { return publish(this.ctx, id, user); }
  unpublish(id: string, user: RequestUser) { return unpublish(this.ctx, id, user); }
  start(id: string, user: RequestUser) { return start(this.ctx, id, user); }
  end(id: string, user: RequestUser) { return end(this.ctx, id, user); }
  bulkUpdateStatus(dto: BulkUpdateExamStatusDto, user: RequestUser) { return bulkUpdateStatus(this.ctx, dto, user); }
}

@Injectable()
export class ExamAnnouncementUseCases {
  constructor(private readonly ctx: ExamsContext) {}

  announcementReads(id: string, user: RequestUser) { return announcementReads(this.ctx, id, user); }
  remindAnnouncementUnread(id: string, content: string | undefined, user: RequestUser) {
    return remindAnnouncementUnread(this.ctx, id, content, user);
  }
}
