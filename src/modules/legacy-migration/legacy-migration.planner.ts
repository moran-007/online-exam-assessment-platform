import { Injectable } from '@nestjs/common';
import { LegacyProfileSnapshotDto } from './dto/legacy-profile-snapshot.dto';
import {
  PlannedConflict,
  accountUsername,
  classCode,
  normalizePhone,
  parentLegacyId,
  usernameFor,
} from './legacy-migration.helpers';

export type ExistingIdentityIndex = {
  usernames: Set<string>;
  phones: Set<string>;
  classCodes: Set<string>;
  mappedKeys: Set<string>;
};

@Injectable()
export class LegacyMigrationPlanner {
  buildConflicts(snapshot: LegacyProfileSnapshotDto, existing: ExistingIdentityIndex) {
    const conflicts: PlannedConflict[] = [];
    const usernameOwners = new Map<string, string[]>();
    const phoneOwners = new Map<string, string[]>();

    for (const student of snapshot.students) {
      const entityKey = this.entityKey('student', student.legacyId);
      if (existing.mappedKeys.has(entityKey)) continue;
      this.collect(usernameOwners, accountUsername(snapshot, 'student', student.legacyId), entityKey);
      this.collectPhone(phoneOwners, student.phone, entityKey);
    }
    for (const teacher of snapshot.teachers) {
      const entityKey = this.entityKey('teacher', teacher.legacyId);
      if (existing.mappedKeys.has(entityKey)) continue;
      this.collect(usernameOwners, accountUsername(snapshot, 'teacher', teacher.legacyId), entityKey);
      this.collectPhone(phoneOwners, teacher.phone, entityKey);
    }

    for (const [username, owners] of usernameOwners) {
      if (owners.length > 1) {
        conflicts.push(this.groupConflict('DUPLICATE_SOURCE_USERNAME', 'student', owners, '旧库账号重复，禁止自动合并'));
      } else if (existing.usernames.has(username.toLowerCase())) {
        conflicts.push(this.singleConflict('CURRENT_USERNAME_CONFLICT', owners[0], '目标系统已有同名账号'));
      }
    }
    for (const [phone, owners] of phoneOwners) {
      if (owners.length > 1) {
        conflicts.push(this.groupConflict('DUPLICATE_SOURCE_PHONE', 'student', owners, '旧库手机号重复，需改为无手机号账号或跳过'));
      } else if (existing.phones.has(phone)) {
        conflicts.push(this.singleConflict('CURRENT_PHONE_CONFLICT', owners[0], '目标系统已有相同手机号'));
      }
    }

    this.parentConflicts(snapshot, existing, conflicts);
    for (const item of snapshot.classes) {
      const entityKey = this.entityKey('class', item.legacyId);
      if (!existing.mappedKeys.has(entityKey) && existing.classCodes.has(classCode(item.legacyId))) {
        conflicts.push(this.singleConflict('CURRENT_CLASS_CODE_CONFLICT', entityKey, '目标系统已有相同迁移班级编码'));
      }
    }
    return conflicts;
  }

  summary(snapshot: LegacyProfileSnapshotDto) {
    const parentPhones = new Set(snapshot.students.map((item) => normalizePhone(item.parentPhone)).filter(Boolean));
    return {
      students: snapshot.students.length,
      teachers: snapshot.teachers.length,
      parents: parentPhones.size,
      classes: snapshot.classes.length,
      classStudents: snapshot.classStudents.length,
      accounts: snapshot.accounts.length,
      passwordFieldsRead: 0,
    };
  }

  private parentConflicts(
    snapshot: LegacyProfileSnapshotDto,
    existing: ExistingIdentityIndex,
    conflicts: PlannedConflict[],
  ) {
    const parents = new Map<string, { names: Set<string>; studentIds: string[] }>();
    for (const student of snapshot.students) {
      const phone = normalizePhone(student.parentPhone);
      if (!phone) {
        if (student.parentName) {
          conflicts.push({
            key: `parent:${student.legacyId}:missing-phone`,
            entityType: 'parent',
            legacyId: student.legacyId,
            type: 'MISSING_PARENT_IDENTIFIER',
            affectedKeys: [`parent-link:${student.legacyId}`],
            message: '家长缺少可用手机号，不能自动创建关联',
          });
        }
        continue;
      }
      const item = parents.get(phone) ?? { names: new Set<string>(), studentIds: [] };
      if (student.parentName) item.names.add(student.parentName.trim());
      item.studentIds.push(student.legacyId);
      parents.set(phone, item);
    }

    for (const [phone, item] of parents) {
      const legacyId = parentLegacyId(phone);
      const entityKey = this.entityKey('parent', legacyId);
      if (existing.mappedKeys.has(entityKey)) continue;
      if (item.names.size > 1) {
        conflicts.push({
          key: `parent:${legacyId}:name-conflict`,
          entityType: 'parent',
          legacyId,
          type: 'PARENT_NAME_CONFLICT',
          affectedKeys: [`parent:${legacyId}`],
          message: '同一手机号对应多个家长姓名，禁止自动合并',
        });
      }
      const username = usernameFor('parent', legacyId);
      if (existing.phones.has(phone) || existing.usernames.has(username.toLowerCase())) {
        conflicts.push({
          key: `parent:${legacyId}:target-conflict`,
          entityType: 'parent',
          legacyId,
          type: 'CURRENT_PARENT_ACCOUNT_CONFLICT',
          affectedKeys: [`parent:${legacyId}`],
          message: '目标系统已有相同家长手机号或账号',
        });
      }
    }
  }

  private collect(index: Map<string, string[]>, value: string, owner: string) {
    const key = value.toLowerCase();
    index.set(key, [...(index.get(key) ?? []), owner]);
  }

  private collectPhone(index: Map<string, string[]>, value: string | undefined, owner: string) {
    const phone = normalizePhone(value);
    if (phone) index.set(phone, [...(index.get(phone) ?? []), owner]);
  }

  private entityKey(type: string, legacyId: string) {
    return `${type}:${legacyId}`;
  }

  private singleConflict(type: string, entityKey: string, message: string): PlannedConflict {
    const [entityType, ...legacy] = entityKey.split(':');
    return {
      key: `${entityKey}:${type.toLowerCase()}`,
      entityType: entityType as PlannedConflict['entityType'],
      legacyId: legacy.join(':'),
      type,
      affectedKeys: [entityKey],
      message,
    };
  }

  private groupConflict(type: string, entityType: PlannedConflict['entityType'], owners: string[], message: string) {
    const digest = owners.join('|').replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 90);
    return {
      key: `${type.toLowerCase()}:${digest}`,
      entityType,
      legacyId: owners[0].split(':').slice(1).join(':'),
      type,
      affectedKeys: owners,
      message,
    } satisfies PlannedConflict;
  }
}
