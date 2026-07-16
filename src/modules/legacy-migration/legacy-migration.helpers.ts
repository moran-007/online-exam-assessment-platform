import { createHash } from 'node:crypto';
import { LegacyProfileSnapshotDto } from './dto/legacy-profile-snapshot.dto';

export type LegacyEntityType = 'student' | 'teacher' | 'parent' | 'class' | 'class_student' | 'class_teacher';

export type PlannedConflict = {
  key: string;
  entityType: LegacyEntityType;
  legacyId: string;
  type: string;
  affectedKeys: string[];
  message: string;
};

export function fingerprintSnapshot(snapshot: LegacyProfileSnapshotDto) {
  const normalized = {
    ...snapshot,
    students: sortByLegacyId(snapshot.students),
    teachers: sortByLegacyId(snapshot.teachers),
    classes: sortByLegacyId(snapshot.classes),
    classStudents: sortByLegacyId(snapshot.classStudents),
    accounts: sortByLegacyId(snapshot.accounts),
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(normalized))).digest('hex');
}

export function normalizePhone(value?: string) {
  const phone = value?.replace(/[^0-9+]/g, '') ?? '';
  return phone.length >= 6 ? phone : undefined;
}

export function usernameFor(prefix: 'student' | 'teacher' | 'parent', legacyId: string, preferred?: string) {
  const normalized = preferred?.trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (normalized) return normalized;
  const suffix = createHash('sha256').update(legacyId).digest('hex').slice(0, 12);
  return `legacy_${prefix}_${suffix}`;
}

export function parentLegacyId(phone: string) {
  return createHash('sha256').update(phone).digest('hex').slice(0, 24);
}

export function classCode(legacyId: string) {
  const suffix = createHash('sha256').update(legacyId).digest('hex').slice(0, 16);
  return `worker_${suffix}`;
}

export function accountUsername(
  snapshot: LegacyProfileSnapshotDto,
  type: 'student' | 'teacher',
  legacyId: string,
) {
  const account = snapshot.accounts.find((item) =>
    type === 'student' ? item.studentLegacyId === legacyId : item.teacherLegacyId === legacyId,
  );
  return usernameFor(type, legacyId, account?.username);
}

function sortByLegacyId<T extends { legacyId: string }>(items: T[]) {
  return [...items].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}
