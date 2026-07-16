import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { evidenceList } from './ai-summary.presenter';
import {
  StudentSummaryDatasetBuilder,
  type StudentSummaryScopeInput,
} from './datasets/student-summary-dataset.builder';
import { createSummaryDatasetInputHash } from './summary-input-hash';

@Injectable()
export class StudentSummaryPreviewUseCases {
  constructor(private readonly builder: StudentSummaryDatasetBuilder) {}

  async preview(input: StudentSummaryScopeInput, user: RequestUser) {
    const dataset = await this.builder.build(input, user);
    const { evidenceIndex, ...facts } = dataset;
    return {
      inputHash: createSummaryDatasetInputHash(dataset),
      ...facts,
      evidence: evidenceList(evidenceIndex as never),
    };
  }
}
