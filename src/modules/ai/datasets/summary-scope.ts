import { BadRequestException } from '@nestjs/common';

export const SUMMARY_DATA_DOMAINS = ['lessons', 'exams', 'homework'] as const;
export type SummaryDataDomain = (typeof SUMMARY_DATA_DOMAINS)[number];

export function normalizeSummaryDomains(value?: SummaryDataDomain[]): SummaryDataDomain[] {
  const domains = value?.length ? [...new Set(value)] : [...SUMMARY_DATA_DOMAINS];
  if (!domains.length || domains.some((item) => !SUMMARY_DATA_DOMAINS.includes(item))) {
    throw new BadRequestException('总结内容必须至少选择上课、考试或作业中的一项');
  }
  return SUMMARY_DATA_DOMAINS.filter((item) => domains.includes(item));
}

export function normalizeRecentExamCount(value?: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 1) throw new BadRequestException('最近考试次数必须是大于 0 的整数');
  return value;
}
