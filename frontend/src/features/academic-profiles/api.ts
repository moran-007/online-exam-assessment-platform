import {
  academicProfilesLinkParent,
  academicProfilesMyChildren,
  academicProfilesParents,
  academicProfilesStudent,
  academicProfilesStudents,
  academicProfilesTeacher,
  academicProfilesTeachers,
  academicProfilesUnlinkParent,
  academicProfilesUpdateStudent,
  academicProfilesUpdateTeacher,
} from '../../api/generated/academic-profile/academic-profile';
import {
  legacyMigrationApprove,
  legacyMigrationDetail,
  legacyMigrationList,
  legacyMigrationResolveConflict,
} from '../../api/generated/legacy-migration/legacy-migration';
import { asGenerated, generatedData } from '../../api/generated-data';

export type AcademicRecord = Record<string, any>;
const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const listStudentProfiles = (keyword?: string) =>
  data<AcademicRecord[]>(academicProfilesStudents(keyword ? { keyword } : undefined));
export const getStudentProfile = (userId: string) =>
  data<AcademicRecord>(academicProfilesStudent(userId));
export const updateStudentProfile = (userId: string, body: Record<string, unknown>) =>
  data<AcademicRecord>(academicProfilesUpdateStudent(userId, body));

export const listTeacherProfiles = (keyword?: string) =>
  data<AcademicRecord[]>(academicProfilesTeachers(keyword ? { keyword } : undefined));
export const getTeacherProfile = (userId: string) =>
  data<AcademicRecord>(academicProfilesTeacher(userId));
export const updateTeacherProfile = (userId: string, body: Record<string, unknown>) =>
  data<AcademicRecord>(academicProfilesUpdateTeacher(userId, body));

export const listParentProfiles = (keyword?: string) =>
  data<AcademicRecord[]>(academicProfilesParents(keyword ? { keyword } : undefined));
export const listMyChildren = () => data<AcademicRecord[]>(academicProfilesMyChildren());
export const linkParentStudent = (body: Record<string, unknown>) =>
  data<AcademicRecord>(academicProfilesLinkParent(body as never));
export const unlinkParentStudent = (parentId: string, studentId: string) =>
  data<boolean>(academicProfilesUnlinkParent(parentId, studentId));

export const listMigrationRuns = () => data<AcademicRecord[]>(legacyMigrationList());
export const getMigrationRun = (id: string) => data<AcademicRecord>(legacyMigrationDetail(id));
export const resolveMigrationConflict = (id: string, body: Record<string, unknown>) =>
  data<AcademicRecord>(legacyMigrationResolveConflict(id, body as never));
export const approveMigrationRun = (id: string) => data<AcademicRecord>(legacyMigrationApprove(id));
