import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ExamSummaryDatasetBuilder } from './datasets/exam-summary-dataset.builder';
import { createSummaryDatasetInputHash } from './summary-input-hash';

@Injectable()
export class ExamSummaryPreviewUseCases {
  constructor(private readonly builder: ExamSummaryDatasetBuilder) {}

  async preview(examId: string, user: RequestUser) {
    const dataset = await this.builder.build(examId, user);
    const { evidenceIndex, ...facts } = dataset;
    return {
      inputHash: createSummaryDatasetInputHash(dataset),
      ...facts,
      evidence: Object.values(evidenceIndex)
        .sort((left, right) => left.refId.localeCompare(right.refId))
        .map((item) => ({ ...item, unit: item.unit ?? null })),
    };
  }
}
