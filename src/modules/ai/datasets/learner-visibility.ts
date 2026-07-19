import { AttemptStatus, ShowScoreMode } from '@prisma/client';

export function isLearnerScoreVisible(
  mode: ShowScoreMode,
  status: AttemptStatus,
  submittedAt: Date | null,
  endTime: Date,
  now = new Date(),
) {
  if (mode === ShowScoreMode.NEVER) return false;
  if (mode === ShowScoreMode.AFTER_SUBMIT) return Boolean(submittedAt);
  if (mode === ShowScoreMode.AFTER_EXAM_END) return endTime <= now;
  return status === AttemptStatus.GRADED;
}
