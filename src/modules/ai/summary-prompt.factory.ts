import type { SupportedSummaryDataset } from './datasets/summary-dataset';
import { buildExamSummaryUserPrompt } from './exam-summary-prompt';
import {
  buildClassSummaryUserPrompt,
  buildLessonAssistantUserPrompt,
  buildParentReportUserPrompt,
} from './integrated-summary-prompt';
import { buildStudentSummaryUserPrompt } from './student-summary-prompt';

export type BuiltSummaryPrompt = {
  userPrompt: string;
  schemaName: string;
};

export function buildSummaryPrompt(dataset: SupportedSummaryDataset): BuiltSummaryPrompt {
  switch (dataset.type) {
    case 'exam':
      return { userPrompt: buildExamSummaryUserPrompt(dataset), schemaName: 'exam_summary' };
    case 'student':
      return { userPrompt: buildStudentSummaryUserPrompt(dataset), schemaName: 'student_summary' };
    case 'class':
      return { userPrompt: buildClassSummaryUserPrompt(dataset), schemaName: 'class_summary' };
    case 'parent_report':
      return { userPrompt: buildParentReportUserPrompt(dataset), schemaName: 'parent_report' };
    case 'lesson':
      return { userPrompt: buildLessonAssistantUserPrompt(dataset), schemaName: 'lesson_assistant' };
  }
}
