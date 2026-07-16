import { LegacyProfileSnapshotDto } from '../../src/modules/legacy-migration/dto/legacy-profile-snapshot.dto';
import { fingerprintSnapshot } from '../../src/modules/legacy-migration/legacy-migration.helpers';
import { LegacyMigrationPlanner } from '../../src/modules/legacy-migration/legacy-migration.planner';

describe('LegacyMigrationPlanner', () => {
  const planner = new LegacyMigrationPlanner();
  const emptyIndex = () => ({
    usernames: new Set<string>(), phones: new Set<string>(), classCodes: new Set<string>(), mappedKeys: new Set<string>(),
  });

  it('never treats equal names as an automatic merge signal', () => {
    const snapshot = baseSnapshot();
    snapshot.students = [
      { legacyId: '1', name: '同名学生' },
      { legacyId: '2', name: '同名学生' },
    ];
    expect(planner.buildConflicts(snapshot, emptyIndex())).toEqual([]);
  });

  it('blocks duplicate source phones and target username collisions', () => {
    const snapshot = baseSnapshot();
    snapshot.students = [
      { legacyId: '1', name: '甲', phone: '138 0000 0000' },
      { legacyId: '2', name: '乙', phone: '13800000000' },
    ];
    snapshot.accounts = [{ legacyId: 'a1', username: 'occupied', studentLegacyId: '1' }];
    const index = emptyIndex();
    index.usernames.add('occupied');
    const types = planner.buildConflicts(snapshot, index).map((item) => item.type);
    expect(types).toEqual(expect.arrayContaining(['DUPLICATE_SOURCE_PHONE', 'CURRENT_USERNAME_CONFLICT']));
  });

  it('reports parent ambiguity without exposing the phone in conflict summaries', () => {
    const snapshot = baseSnapshot();
    snapshot.students = [
      { legacyId: '1', name: '甲', parentName: '家长甲', parentPhone: '13800000000' },
      { legacyId: '2', name: '乙', parentName: '家长乙', parentPhone: '13800000000' },
    ];
    const conflict = planner.buildConflicts(snapshot, emptyIndex()).find((item) => item.type === 'PARENT_NAME_CONFLICT');
    expect(conflict).toBeDefined();
    expect(JSON.stringify(conflict)).not.toContain('13800000000');
  });

  it('keeps fingerprints stable when array order changes', () => {
    const left = baseSnapshot();
    left.students = [{ legacyId: '2', name: '乙' }, { legacyId: '1', name: '甲' }];
    const right = baseSnapshot();
    right.students = [...left.students].reverse();
    expect(fingerprintSnapshot(left)).toBe(fingerprintSnapshot(right));
  });
});

function baseSnapshot(): LegacyProfileSnapshotDto {
  return {
    sourceSystem: 'unit-worker', sourceVersion: 'v1',
    students: [], teachers: [], classes: [], classStudents: [], accounts: [],
  };
}
