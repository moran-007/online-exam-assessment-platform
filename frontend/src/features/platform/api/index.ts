import { authLogin, authLogout, authMe } from '../../../api/generated/auth/auth';
import {
  classesAddStudents,
  classesAddTeachers,
  classesCreate,
  classesDetail,
  classesList,
  classesRemove,
  classesRemoveStudent,
  classesRemoveTeacher,
  classesUpdate,
} from '../../../api/generated/classes/classes';
import { coursesCreate, coursesList, coursesRemove, coursesUpdate } from '../../../api/generated/course/course';
import {
  knowledgePointsCreate,
  knowledgePointsRemove,
  knowledgePointsTree,
  knowledgePointsUpdate,
} from '../../../api/generated/knowledge-point/knowledge-point';
import {
  notificationsList,
  notificationsMarkAllRead,
  notificationsMarkRead,
  notificationsUnreadCount,
} from '../../../api/generated/notification/notification';
import {
  statisticsExams,
  statisticsFusionDashboard,
  statisticsOverview,
} from '../../../api/generated/statistics/statistics';
import type { FusionDashboardDto } from '../../../api/generated/models';
import { tagsCreate, tagsList, tagsRemove, tagsUpdate } from '../../../api/generated/tag/tag';
import {
  usersBatchCreateStudents,
  usersBatchCreateTeachers,
  usersChangeOwnPassword,
  usersCreateRole,
  usersCreateStudent,
  usersCreateTeacher,
  usersCreateUser,
  usersPermissions,
  usersResetPassword,
  usersRoles,
  usersStudents,
  usersTeachers,
  usersUpdateRole,
  usersUpdateRolePermissions,
  usersUpdateUser,
  usersUsers,
} from '../../../api/generated/user/user';
import { asGenerated, generatedData } from '../../../api/generated-data';

export type PlatformRecord = Record<string, any>;
export type PlatformPage = { items: PlatformRecord[]; total: number; page: number; pageSize: number };
const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const login = (body: Parameters<typeof authLogin>[0]) => data<PlatformRecord>(
  authLogin(body, { auth: false } as RequestInit),
);
export const logout = (body: Parameters<typeof authLogout>[0]) => data<PlatformRecord>(
  authLogout(body, { markActivity: true } as RequestInit),
);
export const getCurrentProfile = () => data<PlatformRecord>(authMe());

export const getUnreadNotificationCount = () => data<PlatformRecord>(notificationsUnreadCount());
export const listNotifications = (params?: Parameters<typeof notificationsList>[0]) => data<PlatformPage>(notificationsList(params));
export const markNotificationRead = (id: string) => data<PlatformRecord>(notificationsMarkRead(id));
export const markAllNotificationsRead = () => data<PlatformRecord>(notificationsMarkAllRead());

export const listCourses = (params?: Parameters<typeof coursesList>[0]) => data<PlatformPage>(coursesList(params));
export const createCourse = (body: Parameters<typeof coursesCreate>[0]) => data<PlatformRecord>(coursesCreate(body));
export const updateCourse = (id: string, body: Parameters<typeof coursesUpdate>[1]) => data<PlatformRecord>(coursesUpdate(id, body));
export const removeCourse = (id: string) => data<PlatformRecord>(coursesRemove(id));

export const listClasses = (params?: Parameters<typeof classesList>[0]) => data<PlatformPage>(classesList(params));
export const createClass = (body: Parameters<typeof classesCreate>[0]) => data<PlatformRecord>(classesCreate(body));
export const updateClass = (id: string, body: Parameters<typeof classesUpdate>[1]) => data<PlatformRecord>(classesUpdate(id, body));
export const getClass = (id: string) => data<PlatformRecord>(classesDetail(id));
export const removeClass = (id: string) => data<PlatformRecord>(classesRemove(id));
export const addClassStudents = (id: string, body: Parameters<typeof classesAddStudents>[1]) => data<PlatformRecord>(classesAddStudents(id, body));
export const addClassTeachers = (id: string, body: Parameters<typeof classesAddTeachers>[1]) => data<PlatformRecord>(classesAddTeachers(id, body));
export const removeClassStudent = (id: string, studentId: string) => data<PlatformRecord>(classesRemoveStudent(id, studentId));
export const removeClassTeacher = (id: string, teacherId: string) => data<PlatformRecord>(classesRemoveTeacher(id, teacherId));

export const getKnowledgeTree = (courseId: string) => data<PlatformRecord[]>(knowledgePointsTree({ courseId }));
export const createKnowledgePoint = (body: Parameters<typeof knowledgePointsCreate>[0]) => data<PlatformRecord>(knowledgePointsCreate(body));
export const updateKnowledgePoint = (id: string, body: Parameters<typeof knowledgePointsUpdate>[1]) => data<PlatformRecord>(knowledgePointsUpdate(id, body));
export const removeKnowledgePoint = (id: string) => data<PlatformRecord>(knowledgePointsRemove(id));

export const listTags = (params?: Parameters<typeof tagsList>[0]) => data<PlatformPage>(tagsList(params));
export const createTag = (body: Parameters<typeof tagsCreate>[0]) => data<PlatformRecord>(tagsCreate(body));
export const updateTag = (id: string, body: Parameters<typeof tagsUpdate>[1]) => data<PlatformRecord>(tagsUpdate(id, body));
export const removeTag = (id: string) => data<PlatformRecord>(tagsRemove(id));

export const listUsers = (params?: Parameters<typeof usersUsers>[0]) => data<PlatformPage>(usersUsers(params));
export const createUser = (body: Parameters<typeof usersCreateUser>[0]) => data<PlatformRecord>(usersCreateUser(body));
export const updateUser = (id: string, body: Parameters<typeof usersUpdateUser>[1]) => data<PlatformRecord>(usersUpdateUser(id, body));
export const resetUserPassword = (id: string, body: Parameters<typeof usersResetPassword>[1]) => data<PlatformRecord>(usersResetPassword(id, body));
export const changeOwnPassword = (body: Parameters<typeof usersChangeOwnPassword>[0]) => data<PlatformRecord>(usersChangeOwnPassword(body));
export const listRoles = () => data<PlatformRecord[]>(usersRoles());
export const listPermissions = () => data<PlatformRecord[]>(usersPermissions());
export const createRole = (body: Parameters<typeof usersCreateRole>[0]) => data<PlatformRecord>(usersCreateRole(body));
export const updateRole = (id: string, body: Parameters<typeof usersUpdateRole>[1]) => data<PlatformRecord>(usersUpdateRole(id, body));
export const updateRolePermissions = (id: string, body: Parameters<typeof usersUpdateRolePermissions>[1]) => data<PlatformRecord>(usersUpdateRolePermissions(id, body));
export const listStudents = () => data<PlatformRecord[]>(usersStudents());
export const createStudent = (body: Parameters<typeof usersCreateStudent>[0]) => data<PlatformRecord>(usersCreateStudent(body));
export const batchCreateStudents = (body: Parameters<typeof usersBatchCreateStudents>[0]) => data<PlatformRecord>(usersBatchCreateStudents(body));
export const listTeachers = () => data<PlatformRecord[]>(usersTeachers());
export const createTeacher = (body: Parameters<typeof usersCreateTeacher>[0]) => data<PlatformRecord>(usersCreateTeacher(body));
export const batchCreateTeachers = (body: Parameters<typeof usersBatchCreateTeachers>[0]) => data<PlatformRecord>(usersBatchCreateTeachers(body));

export const getDashboardOverview = () => data<PlatformRecord>(statisticsOverview({}));
export const getDashboardExams = () => data<PlatformPage>(statisticsExams({ pageSize: 10 }));
export const getFusionDashboard = (params?: Parameters<typeof statisticsFusionDashboard>[0]) =>
  data<FusionDashboardDto>(statisticsFusionDashboard(params));
