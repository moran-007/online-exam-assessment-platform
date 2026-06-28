import {
  AttemptStatus,
  ExamStatus,
  PaperStatus,
  PaperType,
  QuestionStatus,
  QuestionType,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

export function normalizeQuestionType(type: string): QuestionType {
  return normalizeEnumValue(type, QuestionType, '题型不合法');
}

export function normalizeQuestionStatus(status: string): QuestionStatus {
  return normalizeEnumValue(status, QuestionStatus, '题目状态不合法');
}

export function normalizePaperType(type: string): PaperType {
  return normalizeEnumValue(type, PaperType, '试卷类型不合法');
}

export function normalizePaperStatus(status: string): PaperStatus {
  return normalizeEnumValue(status, PaperStatus, '试卷状态不合法');
}

export function normalizeExamStatus(status: string): ExamStatus {
  return normalizeEnumValue(status, ExamStatus, '考试状态不合法');
}

export function normalizeAttemptStatus(status: string): AttemptStatus {
  return normalizeEnumValue(status, AttemptStatus, '答题状态不合法');
}

export function toApiEnum(value: string) {
  return value.toLowerCase();
}

function normalizeEnumValue<T extends Record<string, string>>(
  value: string,
  source: T,
  message: string,
): T[keyof T] {
  const normalized = value.replace(/-/g, '_').toUpperCase();
  const result = Object.values(source).find((item) => item === normalized);

  if (!result) {
    throw new BadRequestException(message);
  }

  return result as T[keyof T];
}
