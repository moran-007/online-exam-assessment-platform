export type FillBlankRow = { answerText: string };
export type FillBlank = {
  index: number;
  answers: string[];
  ignoreCase?: boolean;
  trimSpace?: boolean;
  score?: number;
};

export const DEFAULT_BLANK_ANSWER_TEXT: string;
export function emptyFillBlankRows(count?: number): FillBlankRow[];
export function buildFillBlankAnswer(
  value: string,
  totalScore: number,
  options?: { ignoreCase?: boolean; trimSpace?: boolean },
): { blanks: FillBlank[] };
export function fillBlankRowsFromText(value: string, minCount?: number): FillBlankRow[];
export function fillBlankAnswerTextFromRows(rows?: FillBlankRow[]): string;
export function parseFillBlankAnswerText(
  value: string,
  options?: { trimSpace?: boolean },
): FillBlank[];
export function fillBlankAnswerTextFromRules(blanks?: FillBlank[]): string;
