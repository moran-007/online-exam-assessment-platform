import '../setup-env';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  AiSummaryType,
  AnswerRecordStatus,
  AttemptStatus,
  PermissionType,
  Prisma,
  PrismaClient,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Workbook } from 'exceljs';
import { mkdir, rm } from 'node:fs/promises';
import { EXAM_SUMMARY_OUTPUT_SCHEMA } from '../../src/modules/ai/schemas/summary-output.schema';
import { createScratchProjectBuffer } from '../helpers/scratch-project';

const prisma = new PrismaClient();
const password = '123456';
const exportExamName = 'E2E export fixture exam';
const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3100/api/v1';
let examId = '';
let materialExamId = '';
let paperName = '';
let classId = '';
let operationsDate = '';

test.beforeAll(async ({ request }) => {
  await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
  await resetDatabase();
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({
    data: [
      { username: 'e2e_admin', passwordHash, realName: 'E2E Admin', userType: UserType.SUPER_ADMIN },
      { username: 'e2e_teacher', passwordHash, realName: 'E2E Teacher', userType: UserType.TEACHER },
      { username: 'e2e_student', passwordHash, realName: 'E2E Student', userType: UserType.STUDENT },
      { username: 'e2e_parent', passwordHash, realName: 'E2E Parent', phone: '13900000009', userType: UserType.PARENT },
      { username: 'e2e_schedule_reader', passwordHash, realName: 'E2E Schedule Reader', userType: UserType.STUDENT },
      { username: 'e2e_ledger_reader', passwordHash, realName: 'E2E Ledger Reader', userType: UserType.STUDENT },
      { username: 'e2e_catalog_reader', passwordHash, realName: 'E2E Catalog Reader', userType: UserType.STUDENT },
    ],
  });
  const permissionRows = await Promise.all([
    ['academic-profile:read', 'Read academic profile'],
    ['lesson-type:read', 'Read lesson types'],
    ['course-unit:read', 'Read course units'],
    ['schedule:read', 'Read schedule'],
    ['schedule:manage', 'Manage schedule'],
    ['attendance:read', 'Read attendance'],
    ['attendance:confirm', 'Confirm attendance'],
    ['attendance:correct', 'Correct attendance'],
    ['lesson-hour:read', 'Read lesson hours'],
    ['lesson-record:read', 'Read published lesson records'],
    ['lesson-record:manage', 'Manage lesson records'],
    ['scratch-template:read', 'Read Scratch templates'],
    ['scratch-template:manage', 'Manage Scratch templates'],
    ['scratch-assignment:read', 'Read Scratch assignments'],
    ['scratch-assignment:manage', 'Manage Scratch assignments'],
    ['scratch-assignment:publish', 'Publish Scratch assignments'],
    ['scratch-work:read', 'Read Scratch works'],
    ['scratch-work:save', 'Save Scratch works'],
    ['scratch-work:submit', 'Submit Scratch works'],
    ['scratch-work:review', 'Review Scratch works'],
    ['scratch-asset:download', 'Download Scratch assets'],
    ['scratch-judge:manage', 'Manage Scratch judge runs'],
    ['dashboard:read', 'Read fused dashboard'],
  ].map(([code, name]) => prisma.permission.create({ data: { name, code, type: PermissionType.API } })));
  const roleRows = await Promise.all([
    prisma.role.create({ data: { name: 'E2E Teacher', code: 'teacher' } }),
    prisma.role.create({ data: { name: 'E2E Student', code: 'student' } }),
    prisma.role.create({ data: { name: 'E2E Parent', code: 'parent' } }),
    prisma.role.create({ data: { name: 'E2E Schedule Reader', code: 'e2e_schedule_reader' } }),
    prisma.role.create({ data: { name: 'E2E Ledger Reader', code: 'e2e_ledger_reader' } }),
    prisma.role.create({ data: { name: 'E2E Catalog Reader', code: 'e2e_catalog_reader' } }),
  ]);
  const readCodes = new Set([
    'academic-profile:read', 'schedule:read', 'attendance:read', 'lesson-hour:read',
    'lesson-record:read', 'scratch-assignment:read', 'scratch-work:read',
    'scratch-asset:download', 'dashboard:read',
  ]);
  const studentWriteCodes = new Set(['scratch-work:save', 'scratch-work:submit']);
  await prisma.rolePermission.createMany({
    data: roleRows.slice(0, 3).flatMap((role) => permissionRows
      .filter((permission) => role.code === 'teacher' || readCodes.has(permission.code) || (
        role.code === 'student' && studentWriteCodes.has(permission.code)
      ))
      .map((permission) => ({ roleId: role.id, permissionId: permission.id }))),
  });
  const fixtureUsers = await prisma.user.findMany({
    where: { username: { in: ['e2e_teacher', 'e2e_student', 'e2e_parent'] } },
    select: { id: true, userType: true },
  });
  await prisma.userRole.createMany({
    data: fixtureUsers.map((user) => ({
      userId: user.id,
      roleId: roleRows.find((role) => role.code === user.userType.toLowerCase())!.id,
    })),
  });
  const partialRolePermissions = [
    ['e2e_schedule_reader', ['schedule:read']],
    ['e2e_ledger_reader', ['lesson-hour:read']],
    ['e2e_catalog_reader', ['lesson-type:read', 'course-unit:read']],
  ] as const;
  await prisma.rolePermission.createMany({
    data: partialRolePermissions.flatMap(([roleCode, codes]) => codes.map((code) => ({
      roleId: roleRows.find((role) => role.code === roleCode)!.id,
      permissionId: permissionRows.find((permission) => permission.code === code)!.id,
    }))),
  });
  const partialUsers = await prisma.user.findMany({
    where: { username: { in: partialRolePermissions.map(([code]) => code) } },
    select: { id: true, username: true },
  });
  await prisma.userRole.createMany({
    data: partialUsers.map((user) => ({
      userId: user.id,
      roleId: roleRows.find((role) => role.code === user.username)!.id,
    })),
  });

  const login = await api(request, 'post', '/auth/login', undefined, {
    username: 'e2e_admin', password, rememberMe: false,
  });
  const token = login.accessToken as string;
  const course = await api(request, 'post', '/courses', token, {
    name: 'E2E Browser Course', code: 'e2e_browser_course', description: 'Playwright fixture', sortOrder: 1,
  });
  const classGroup = await api(request, 'post', '/classes', token, {
    name: 'E2E Browser Class', courseId: course.id, code: 'e2e_browser_class', status: 'active',
  });
  classId = classGroup.id;
  const chapter = await prisma.knowledgePoint.create({
    data: { courseId: course.id, name: 'E2E 第一章', code: 'e2e_chapter_1', level: 1, sortOrder: 1 },
  });
  await prisma.knowledgePoint.createMany({
    data: [1, 2, 3].map((sequence) => ({
      courseId: course.id,
      parentId: chapter.id,
      name: `E2E 知识点 ${sequence}`,
      code: `e2e_kp_${sequence}`,
      level: 2,
      sortOrder: sequence,
    })),
  });
  const [admin, student] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: 'e2e_admin' } }),
    prisma.user.findUniqueOrThrow({ where: { username: 'e2e_student' } }),
  ]);
  await seedExamSummaryPrompt(admin.id);
  await api(request, 'post', `/classes/${classId}/students`, token, { userIds: [student.id] });
  operationsDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const operationsEndDate = new Date(new Date(`${operationsDate}T00:00:00.000Z`).getTime() + 14 * 86_400_000)
    .toISOString().slice(0, 10);
  const operationsType = await api(request, 'post', '/lesson-types', token, {
    name: 'E2E 计费正课', defaultHours: 1, countInStatistics: true, active: true,
  });
  const scratchTeacher = await prisma.user.findUniqueOrThrow({ where: { username: 'e2e_teacher' } });
  await prisma.lessonSession.create({
    data: {
      classId,
      teacherId: scratchTeacher.id,
      lessonTypeId: operationsType.id,
      generationKey: 'e2e:scratch-classroom',
      title: 'E2E Scratch 课堂',
      startsAt: new Date(`${operationsDate}T09:00:00+08:00`),
      endsAt: new Date(`${operationsDate}T10:00:00+08:00`),
      createdBy: scratchTeacher.id,
      updatedBy: scratchTeacher.id,
    },
  });
  await api(request, 'post', '/schedule-rules', token, {
    classId,
    lessonTypeId: operationsType.id,
    weekday: new Date(`${operationsDate}T00:00:00.000Z`).getUTCDay(),
    startMinute: 1080,
    endMinute: 1140,
    effectiveFrom: operationsDate,
    effectiveTo: operationsEndDate,
    timezone: 'Asia/Shanghai',
    lessonHours: 1,
    classroom: 'E2E Lab',
  });
  await api(request, 'post', '/lesson-hours/adjustments', token, {
    studentId: student.id,
    classId,
    type: 'OPENING_BALANCE',
    amount: 5,
    idempotencyKey: 'e2e-opening-balance',
    note: 'E2E opening balance',
  });
  await api(request, 'post', '/legacy-migrations/preflight', token, {
    sourceSystem: 'e2e-worker', sourceVersion: 'profile-v1',
    students: [{ legacyId: 'conflict-student', name: 'Conflict Student', phone: '13900000008' }],
    teachers: [], classes: [], classStudents: [],
    accounts: [{ legacyId: 'conflict-account', username: 'e2e_student', studentLegacyId: 'conflict-student' }],
  });
  const question = await api(request, 'post', '/questions', token, {
    courseId: course.id,
    type: 'single_choice',
    title: 'E2E autosave question',
    content: 'Choose the correct browser answer',
    difficulty: 1,
    defaultScore: 5,
    options: [
      { optionKey: 'A', content: 'Correct browser answer', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: 'Wrong browser answer', isCorrect: false, sortOrder: 2 },
    ],
  });
  await api(request, 'post', `/questions/${question.id}/publish`, token);
  paperName = `E2E paper ${Date.now()}`;
  const paper = await api(request, 'post', '/papers', token, {
    name: paperName, courseId: course.id, durationMinutes: 30, type: 'fixed',
  });
  await api(request, 'post', `/papers/${paper.id}/questions`, token, {
    questionId: question.id, score: 5, sortOrder: 1,
  });
  await api(request, 'post', `/papers/${paper.id}/publish`, token);
  await seedExportExamFixture(request, token, {
    adminId: admin.id,
    courseId: course.id,
    paperId: paper.id,
    questionId: question.id,
    studentId: student.id,
  });
  const exam = await api(request, 'post', '/exams', token, {
    paperId: paper.id,
    name: 'E2E forced-end exam',
    courseId: course.id,
    startTime: new Date(Date.now() - 60_000).toISOString(),
    endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
    durationMinutes: 30,
    attemptLimit: 1,
    showScoreMode: 'after_submit',
  });
  examId = exam.id;
  await api(request, 'post', `/exams/${examId}/publish`, token);
  await api(request, 'post', `/exams/${examId}/start`, token);

  const materialChoice = await api(request, 'post', '/questions', token, {
    courseId: course.id, type: 'single_choice', title: 'E2E material child choice', content: 'Material child choice',
    difficulty: 1, defaultScore: 3,
    options: [
      { optionKey: 'A', content: 'Correct material option', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: 'Wrong material option', isCorrect: false, sortOrder: 2 },
    ],
  });
  const materialShort = await api(request, 'post', '/questions', token, {
    courseId: course.id, type: 'short_answer', title: 'E2E rubric child', content: 'Explain the material',
    difficulty: 2, defaultScore: 7, answer: { reference: 'reference' },
    scoringRule: { rubric: [{ id: 'accuracy', name: '准确性', maxScore: 5 }, { id: 'clarity', name: '表达', maxScore: 2 }] },
  });
  await api(request, 'post', `/questions/${materialChoice.id}/publish`, token);
  await api(request, 'post', `/questions/${materialShort.id}/publish`, token);
  const material = await api(request, 'post', '/questions', token, {
    courseId: course.id, type: 'material', title: 'E2E material title', content: 'E2E shared material context',
    difficulty: 2, defaultScore: 10,
    children: [
      { questionId: materialChoice.id, score: 3, sortOrder: 1 },
      { questionId: materialShort.id, score: 7, sortOrder: 2 },
    ],
  });
  await api(request, 'post', `/questions/${material.id}/publish`, token);
  const materialPaper = await api(request, 'post', '/papers', token, {
    name: 'E2E material paper', courseId: course.id, durationMinutes: 30, type: 'fixed',
  });
  await api(request, 'post', `/papers/${materialPaper.id}/questions`, token, { questionId: material.id, score: 10, sortOrder: 1 });
  await api(request, 'post', `/papers/${materialPaper.id}/publish`, token);
  const materialExam = await api(request, 'post', '/exams', token, {
    paperId: materialPaper.id, name: 'E2E material rubric exam', courseId: course.id,
    startTime: new Date(Date.now() - 60_000).toISOString(), endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
    durationMinutes: 30, attemptLimit: 1, showScoreMode: 'after_graded',
  });
  materialExamId = materialExam.id;
  await api(request, 'post', `/exams/${materialExamId}/publish`, token);
  await api(request, 'post', `/exams/${materialExamId}/start`, token);
});

test.afterAll(async () => {
  await prisma.$disconnect();
  await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
});

test('student autosave survives refresh and forced end finalizes the latest answer', async ({ browser }) => {
  const adminSession = await browser.newContext();
  const studentSession = await browser.newContext();
  const adminPage = await adminSession.newPage();
  const studentPage = await studentSession.newPage();

  await login(adminPage, 'e2e_admin');
  await expect(adminPage).toHaveURL(/\/dashboard$/);
  await login(studentPage, 'e2e_student');
  await expect(studentPage).toHaveURL(/\/dashboard$/);

  await studentPage.goto(`/student/exams/${examId}`);
  await expect(studentPage.getByRole('heading', { name: 'E2E forced-end exam' })).toBeVisible();

  const autosave = studentPage.waitForResponse((response) =>
    response.url().includes('/save-answers') && response.request().method() === 'POST' && response.ok(),
  );
  await studentPage.getByText('Wrong browser answer', { exact: true }).click();
  await autosave;
  await studentPage.reload();
  await expect(studentPage.locator('.el-radio.is-checked').filter({ hasText: 'Wrong browser answer' })).toBeVisible();

  await studentPage.getByText('Correct browser answer', { exact: true }).click();
  const endStatus = await adminPage.evaluate(async (id) => {
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    const response = await fetch(`/api/v1/exams/${id}/end`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    return response.status;
  }, examId);
  expect(endStatus).toBe(201);

  await expect(studentPage).toHaveURL(/\/student\/attempts\/.+\/result$/, { timeout: 20_000 });
  await expect(studentPage.locator('.review-metrics .metric').filter({ hasText: '总分' }).locator('strong')).toHaveText('5');

  await studentPage.goto('/student/papers');
  await expect(studentPage.getByText(paperName, { exact: true })).toBeVisible();
  await studentPage.goto('/student/wrong-questions');
  await expect(studentPage.getByRole('heading', { name: '错题本', exact: true })).toBeVisible();
  await expect(studentPage.getByPlaceholder('搜索公开题目后加入错题本')).toBeVisible();
  await adminSession.close();
  await studentSession.close();
});

test('expired local session returns to login with a clear reason', async ({ page }) => {
  await login(page, 'e2e_student');
  await page.evaluate(() => {
    const storage = localStorage.getItem('sessionMeta') ? localStorage : sessionStorage;
    const metadata = JSON.parse(storage.getItem('sessionMeta') || '{}');
    storage.setItem('sessionMeta', JSON.stringify({
      ...metadata,
      idleTimeoutMs: 1,
      lastActivityAt: Date.now() - 10_000,
      expiresAt: '2000-01-01T00:00:00.000Z',
    }));
  });
  await page.goto('/student/profile');
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.locator('.el-alert').getByText('登录已失效，请重新登录')).toBeVisible();
});

test('public visitors and teachers load their lazy feature routes', async ({ browser }) => {
  const publicContext = await browser.newContext();
  const teacherContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const teacherPage = await teacherContext.newPage();

  await publicPage.goto('/question-bank');
  await expect(publicPage.getByRole('heading', { name: '题库', exact: true })).toBeVisible();
  await expect(publicPage.getByText('E2E autosave question', { exact: true })).toBeVisible();

  await login(teacherPage, 'e2e_teacher');
  await expect(teacherPage).toHaveURL(/\/dashboard$/);
  await teacherPage.goto('/ai-settings');
  await expect(teacherPage.getByRole('heading', { name: 'AI 中心' })).toBeVisible();
  await teacherPage.goto('/external-accounts');
  await expect(teacherPage.getByRole('heading', { name: '外部账号' })).toBeVisible();
  await expect(teacherPage.getByText('我的账号', { exact: true })).toBeVisible();

  await publicContext.close();
  await teacherContext.close();
});

test('question, paper, result, and grading exports download usable files', async ({ page }) => {
  await login(page, 'e2e_admin');
  await page.goto('/questions');
  await expect(page.getByRole('heading', { name: '题库管理' })).toBeVisible();

  await page.locator('.question-toolbar .el-switch').click();
  await page.getByRole('tab', { name: '考试中' }).click();
  await page.getByPlaceholder('题目关键词').fill('E2E autosave question');
  await page.getByRole('button', { name: '查询' }).click();
  const questionRow = page.getByRole('row', { name: /E2E autosave question/ });
  await expect(page.locator('.question-table-panel')).toContainText(/E2E autosave question|暂无数据/);
  if (!(await questionRow.isVisible())) {
    await page.getByRole('tab', { name: '已公开' }).click();
    await expect(questionRow).toBeVisible();
  }
  await questionRow.getByRole('button', { name: '操作' }).click();
  await page.getByRole('menuitem', { name: '下载' }).click();
  const questionExportDialog = page.getByRole('dialog', { name: '题目导出设置' });
  await questionExportDialog.getByText('JSON', { exact: true }).click();
  await questionExportDialog.getByRole('button', { name: '生成导出' }).click();
  await expect(page.getByText('题目导出任务已加入队列，可到导出中心下载')).toBeVisible();

  await page.goto('/exports');
  await expect(page.getByRole('heading', { name: '导出中心' })).toBeVisible();
  const questionTaskRow = page.locator('.export-record-panel tbody tr').filter({ hasText: '题库' }).first();
  await expect(questionTaskRow).toContainText('成功', { timeout: 20_000 });
  const downloadedQuestion = await captureExportDownload(page, () =>
    questionTaskRow.getByRole('button', { name: '下载' }).click(),
  );
  expect(downloadedQuestion.headers['content-disposition']).toMatch(/\.json/i);
  const questionBuffer = downloadedQuestion.body;
  expect(() => JSON.parse(questionBuffer.toString('utf8'))).not.toThrow();

  const paperRow = page.locator('.export-target-panel tbody tr').filter({ hasText: paperName }).first();
  await paperRow.getByRole('button', { name: '导出' }).click();
  await page.getByRole('menuitem', { name: 'PDF 学生版' }).click();
  await expect(page.getByText('导出任务已加入队列，可在导出记录查看进度')).toBeVisible();
  const paperTaskRow = page.locator('.export-record-panel tbody tr').filter({ hasText: '试卷文档' }).first();
  await expect(paperTaskRow).toContainText('成功', { timeout: 20_000 });
  const downloadedPaper = await captureExportDownload(page, () =>
    paperTaskRow.getByRole('button', { name: '下载' }).click(),
  );
  expect(downloadedPaper.headers['content-disposition']).toMatch(/\.pdf/i);
  const paperBuffer = downloadedPaper.body;
  expect(paperBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(paperBuffer.includes(Buffer.from('%%EOF'))).toBe(true);

  await page.getByRole('tab', { name: '成绩 / 考试导出' }).click();
  await page.getByPlaceholder('搜索考试').fill(exportExamName);
  await page.getByRole('button', { name: '查询' }).click();
  const examRow = page.locator('.question-list-table tbody tr').filter({ hasText: exportExamName }).first();
  await expect(examRow).toBeVisible();
  await examRow.getByRole('button', { name: '导出' }).click();
  await page.getByRole('menuitem', { name: '成绩 Excel' }).click();
  const resultTaskRow = page.locator('.export-record-panel tbody tr').filter({ hasText: '考试成绩' }).first();
  await expect(resultTaskRow).toContainText('成功', { timeout: 20_000 });
  const downloadedResults = await captureExportDownload(page, () =>
    resultTaskRow.getByRole('button', { name: '下载' }).click(),
  );
  expect(downloadedResults.headers['content-disposition']).toMatch(/\.xlsx/i);
  const workbook = new Workbook();
  await workbook.xlsx.load(Uint8Array.from(downloadedResults.body).buffer);
  const resultText = workbook.worksheets[0].getSheetValues().flat(2).join(' | ');
  expect(resultText).toContain(exportExamName);
  expect(resultText).toContain('E2E Student');

  await examRow.getByRole('button', { name: '导出' }).click();
  await page.getByRole('menuitem', { name: '批改记录 CSV' }).click();
  const gradingTaskRow = page.locator('.export-record-panel tbody tr').filter({ hasText: '批改记录' }).first();
  await expect(gradingTaskRow).toContainText('成功', { timeout: 20_000 });
  const downloadedGrading = await captureExportDownload(page, () =>
    gradingTaskRow.getByRole('button', { name: '下载' }).click(),
  );
  expect(downloadedGrading.headers['content-disposition']).toMatch(/\.csv/i);
  const gradingText = downloadedGrading.body.toString('utf8').replace(/^\uFEFF/, '');
  expect(gradingText).toContain(exportExamName);
  expect(gradingText).toContain('E2E Student');
});

test('privileged users can open AI settings while students are denied', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const studentPage = await studentContext.newPage();

  await login(adminPage, 'e2e_admin');
  await ensureE2eAiConfigurations(adminPage);
  const defaultConfigRow = adminPage.getByRole('row', { name: /E2E Default Model/ });
  await defaultConfigRow.getByRole('button', { name: '测试' }).click();
  await expect(defaultConfigRow).toContainText('连接成功');
  await adminPage.goto('/classes');
  await expect(adminPage.getByRole('heading', { name: '班级管理' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: '新增班级' })).toBeVisible();
  await adminPage.getByText('E2E Browser Class', { exact: true }).click();
  await expect(adminPage.getByText('E2E Student', { exact: true })).toBeVisible();
  await adminPage.getByRole('button', { name: 'AI 总结' }).click();
  const studentSummaryDialog = adminPage.getByRole('dialog', { name: /AI 学生阶段 · E2E Student/ });
  await expect(studentSummaryDialog).toBeVisible();
  await expect(studentSummaryDialog.getByText('数据覆盖：')).toBeVisible();
  await expect(studentSummaryDialog.getByText('未提交', { exact: true })).toBeVisible();
  await studentSummaryDialog.locator('.el-dialog__headerbtn').click();
  await expect(studentSummaryDialog).toBeHidden();
  const studentRow = adminPage.getByRole('row', { name: /E2E Student/ });
  await studentRow.locator('.el-checkbox').click();
  await adminPage.getByRole('button', { name: 'AI 批量预算' }).click();
  const budgetDialog = adminPage.getByText('确认 AI 批量预算', { exact: true });
  await expect(budgetDialog).toBeVisible();
  await expect(adminPage.getByText(/共 1 个任务.*最坏情况预留 \d+ Token/)).toBeVisible();
  await adminPage.locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('批量预算已确认，可按需逐人生成')).toBeVisible();
  await adminPage.goto('/users');
  await expect(adminPage.getByRole('heading', { name: '用户权限' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: '新增用户' })).toBeVisible();
  await adminPage.goto('/knowledge');
  await expect(adminPage.getByRole('heading', { name: '课程知识点管理' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: '批量导入知识点' })).toBeVisible();

  await login(studentPage, 'e2e_student');
  await studentPage.goto('/ai-settings');
  await expect(studentPage).not.toHaveURL(/\/ai-settings$/);
  await expect(studentPage.getByRole('heading', { name: 'AI 中心' })).toHaveCount(0);

  await adminContext.close();
  await studentContext.close();
});

test('AI configuration deletion uses a styled Chinese confirmation and preserves usage history', async ({ page }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'e2e_admin' } });
  const name = `E2E 可删除历史配置 ${Date.now()}`;
  const config = await prisma.aiProviderConfig.create({
    data: {
      name,
      provider: 'custom',
      baseUrl: 'https://delete-guard.example.com/v1',
      model: 'delete-guard-model',
      apiKeyCiphertext: 'e2e-delete-ciphertext',
      apiKeyIv: 'e2e-delete-iv',
      apiKeyAuthTag: 'e2e-delete-tag',
      apiKeyKeyVersion: 1,
      enabled: false,
      createdBy: admin.id,
      updatedBy: admin.id,
    },
  });
  await prisma.aiUsageEvent.create({
    data: {
      providerConfigId: config.id,
      operation: 'e2e-delete-guard',
      correlationId: `e2e-delete-${config.id}`,
      reservationOutputTokens: 1,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageReported: false,
      createdBy: admin.id,
    },
  });

  await login(page, 'e2e_admin');
  await page.goto('/ai-settings');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await row.getByRole('button', { name: '删除' }).click();

  const confirmation = page.getByRole('dialog', { name: '删除 AI 配置' });
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeVisible();
  await expect(confirmation.getByRole('button', { name: '确定' })).toBeVisible();
  const box = await confirmation.locator('.el-message-box').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(600);
  expect(box!.x).toBeGreaterThan(0);
  expect(box!.y).toBeGreaterThan(0);

  await confirmation.getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('AI 配置已删除')).toBeVisible();
  await expect(row).toHaveCount(0);
  const retired = await prisma.aiProviderConfig.findUniqueOrThrow({ where: { id: config.id } });
  expect(retired.deletedAt).toBeInstanceOf(Date);
  expect(retired.apiKeyCiphertext).not.toBe('e2e-delete-ciphertext');
  expect(await prisma.aiUsageEvent.count({ where: { providerConfigId: config.id } })).toBe(1);
});

test('teaching operations honors independent read permissions without forbidden requests', async ({ browser }) => {
  const cases = [
    {
      username: 'e2e_schedule_reader',
      visible: ['排课日历', '排课规则'],
      hidden: ['考勤确认', '课时台账', '课型设置'],
    },
    {
      username: 'e2e_ledger_reader',
      visible: ['课时台账'],
      hidden: ['排课日历', '考勤确认', '排课规则', '课型设置'],
    },
    {
      username: 'e2e_catalog_reader',
      visible: ['课型设置'],
      hidden: ['排课日历', '考勤确认', '课时台账', '排课规则'],
    },
  ];
  for (const item of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const forbidden: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 403 && response.url().includes('/api/v1/')) forbidden.push(response.url());
    });
    await login(page, item.username);
    await page.goto('/teaching-operations');
    await expect(page.getByRole('heading', { name: '教学运营' })).toBeVisible();
    for (const tab of item.visible) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    for (const tab of item.hidden) await expect(page.getByRole('tab', { name: tab })).toHaveCount(0);
    if (item.username === 'e2e_catalog_reader') {
      await expect(page.getByTestId('lesson-type-table')).toBeVisible();
      await expect(page.getByTestId('create-lesson-type')).toHaveCount(0);
    }
    expect(forbidden).toEqual([]);
    await context.close();
  }
});

test('course and nested knowledge items support create, view, edit, and delete through clicks', async ({ page }) => {
  const suffix = Date.now();
  const courseName = `E2E CRUD Course ${suffix}`;
  const editedCourseName = `${courseName} Updated`;
  await login(page, 'e2e_admin');
  await page.goto('/courses');
  await expect(page.getByRole('menuitem', { name: '课程与知识点' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '题库' })).toBeVisible();
  await page.getByRole('button', { name: '新增课程' }).click();
  const createCourseDialog = page.getByRole('dialog', { name: '新增课程' });
  await formInput(createCourseDialog, '名称').fill(courseName);
  await createCourseDialog.locator('textarea').fill('课程与教务、测评共用的点击验收课程');
  await createCourseDialog.getByRole('button', { name: '新增课程' }).click();
  await expect(page.getByText('已新增课程')).toBeVisible();

  let courseRow = page.getByRole('row', { name: new RegExp(courseName) });
  await courseRow.click();
  const editCourseDialog = page.getByRole('dialog', { name: '编辑课程' });
  await formInput(editCourseDialog, '名称').fill(editedCourseName);
  await editCourseDialog.locator('textarea').fill('已修改：课程关联和子项维护验收');
  await editCourseDialog.getByRole('button', { name: '保存课程' }).click();
  await expect(page.getByText('课程已保存')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(editedCourseName) })).toContainText('已修改');

  await page.goto('/knowledge');
  await page.locator('.knowledge-course-item').filter({ hasText: editedCourseName }).click();
  await expect(page.locator('.knowledge-main-head')).toContainText(editedCourseName);
  await page.getByRole('button', { name: '新增一级' }).click();
  const rootDialog = page.getByRole('dialog', { name: '新增知识点' });
  await formInput(rootDialog, '名称').fill('E2E 根知识点');
  await rootDialog.getByRole('button', { name: '新增知识点' }).click();
  await expect(page.getByText('已新增')).toBeVisible();

  const rootNode = page.locator('.knowledge-node').filter({ hasText: 'E2E 根知识点' }).first();
  await rootNode.getByRole('button', { name: '添加子级' }).click();
  const childDialog = page.getByRole('dialog', { name: '新增知识点' });
  await formInput(childDialog, '名称').fill('E2E 子知识点');
  await childDialog.getByRole('button', { name: '新增知识点' }).click();
  await expect(page.getByText('E2E 子知识点', { exact: true })).toBeVisible();

  let childNode = page.locator('.knowledge-node').filter({ hasText: 'E2E 子知识点' }).first();
  await childNode.getByRole('button', { name: '编辑' }).click();
  const editChildDialog = page.getByRole('dialog', { name: '编辑知识点' });
  await formInput(editChildDialog, '名称').fill('E2E 子知识点（已修改）');
  await editChildDialog.getByRole('button', { name: '保存知识点' }).click();
  await expect(page.getByText('知识点已保存')).toBeVisible();
  childNode = page.locator('.knowledge-node').filter({ hasText: 'E2E 子知识点（已修改）' }).first();
  await childNode.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog', { name: '删除知识点' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('知识点已删除')).toBeVisible();
  await rootNode.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog', { name: '删除知识点' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('E2E 根知识点', { exact: true })).toHaveCount(0);

  await page.goto('/courses');
  courseRow = page.getByRole('row', { name: new RegExp(editedCourseName) });
  await courseRow.getByRole('button', { name: '操作' }).click();
  await page.locator('.el-dropdown-menu:visible').getByText('删除', { exact: true }).click();
  await page.getByRole('dialog', { name: '删除课程' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('课程已删除')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(editedCourseName) })).toHaveCount(0);
});

test('academic profiles, parent scope and Gate C are operable through browser clicks', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const parentPage = await parentContext.newPage();
  const studentPage = await studentContext.newPage();

  await login(adminPage, 'e2e_admin');
  await adminPage.goto('/academic-profiles');
  await expect(adminPage.getByRole('heading', { name: '教务档案' })).toBeVisible();

  const studentRow = adminPage.getByRole('row', { name: /E2E Student/ });
  await studentRow.getByRole('button', { name: '编辑档案' }).click();
  const studentDialog = adminPage.getByRole('dialog', { name: '编辑学生档案' });
  await formInput(studentDialog, '学号').fill('S-E2E-001');
  await formInput(studentDialog, '学校').fill('E2E School');
  await formInput(studentDialog, '年级').fill('Grade 6');
  await studentDialog.getByRole('button', { name: '保存档案' }).click();
  await expect(adminPage.getByText('档案已保存').last()).toBeVisible();
  await expect(studentRow).toContainText('S-E2E-001');

  await adminPage.getByRole('tab', { name: '教师档案' }).click();
  const teacherRow = adminPage.getByRole('row', { name: /E2E Teacher/ });
  await teacherRow.getByRole('button', { name: '编辑档案' }).click();
  const teacherDialog = adminPage.getByRole('dialog', { name: '编辑教师档案' });
  await formInput(teacherDialog, '工号').fill('T-E2E-001');
  await formInput(teacherDialog, '任教学科').fill('编程');
  await teacherDialog.getByRole('button', { name: '保存档案' }).click();
  await expect(adminPage.getByText('档案已保存').last()).toBeVisible();

  await adminPage.getByRole('tab', { name: '家长关系' }).click();
  await adminPage.getByRole('button', { name: '关联家长' }).click();
  const parentDialog = adminPage.getByRole('dialog', { name: '关联家长与学生' });
  await formSelect(parentDialog, '家长').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E Parent' }).click();
  await formSelect(parentDialog, '学生').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E Student' }).click();
  await parentDialog.getByRole('button', { name: '保存关系' }).click();
  await expect(adminPage.getByText('家长关系已保存')).toBeVisible();
  await expect(adminPage.getByRole('row', { name: /E2E Parent/ })).toContainText('E2E Student');

  await adminPage.getByRole('tab', { name: '迁移演练' }).click();
  const migrationRow = adminPage.getByRole('row', { name: /e2e-worker/ });
  await expect(migrationRow).toContainText('预检阻断');
  await migrationRow.getByRole('button', { name: '查看处置' }).click();
  await adminPage.getByRole('button', { name: '处置并签字' }).click();
  const resolutionDialog = adminPage.getByRole('dialog', { name: '处置身份冲突' });
  await resolutionDialog.locator('input').fill('浏览器验收：保留现有账号并跳过冲突对象');
  await resolutionDialog.locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('冲突已处置并记录责任人')).toBeVisible();
  await adminPage.getByRole('button', { name: '批准迁移' }).click();
  const approvalDialog = adminPage.getByRole('dialog', { name: '批准档案迁移' });
  await approvalDialog.locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('迁移演练已批准')).toBeVisible();

  await adminPage.goto('/classes');
  await adminPage.getByText('E2E Browser Class', { exact: true }).click();
  await adminPage.getByTestId('class-teacher-select').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E Teacher' }).click();
  await adminPage.getByTestId('class-teacher-role').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: '负责人' }).click();
  await adminPage.getByTestId('class-add-teachers').click();
  await expect(adminPage.getByRole('row', { name: /E2E Teacher/ })).toContainText('负责人');
  const rosterStudent = adminPage.getByRole('row', { name: /E2E Student/ });
  await rosterStudent.getByRole('button', { name: '移除' }).click();
  await expect(adminPage.getByRole('row', { name: /E2E Student/ })).toHaveCount(0);
  await adminPage.getByTestId('class-student-select').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E Student' }).click();
  await adminPage.getByTestId('class-add-students').click();
  await expect(adminPage.getByRole('row', { name: /E2E Student/ })).toBeVisible();

  await login(parentPage, 'e2e_parent');
  await expect(parentPage).toHaveURL(/\/dashboard$/);
  await parentPage.goto('/profile');
  await expect(parentPage.getByRole('heading', { name: '明确关联学生' })).toBeVisible();
  await expect(parentPage.getByText('E2E Student', { exact: true })).toBeVisible();
  await login(studentPage, 'e2e_student');
  await studentPage.goto('/student/profile');
  await expect(studentPage.getByText('S-E2E-001', { exact: true })).toBeVisible();
  await expect(studentPage.getByText('E2E School', { exact: true })).toBeVisible();

  await adminContext.close();
  await parentContext.close();
  await studentContext.close();
});

test('lesson types and schedule presets support create, edit, disable, and archive through clicks', async ({ page }) => {
  const suffix = Date.now();
  const typeName = `E2E 课型 ${suffix}`;
  const editedTypeName = `${typeName} 已停用`;
  const teacher = await prisma.user.findUniqueOrThrow({ where: { username: 'e2e_teacher' } });
  await prisma.classTeacher.upsert({
    where: { classId_teacherId: { classId, teacherId: teacher.id } },
    update: { status: 'ACTIVE', leftAt: null },
    create: { classId, teacherId: teacher.id, role: 'LEAD' },
  });

  await login(page, 'e2e_admin');
  await page.goto('/teaching-operations');
  await page.getByRole('tab', { name: '课型设置' }).click();
  const lessonTypeTable = page.getByTestId('lesson-type-table');

  await page.getByTestId('create-lesson-type').click();
  const typeDialog = page.getByRole('dialog', { name: '新增课型' });
  await formInput(typeDialog, '名称').fill(typeName);
  await formInput(typeDialog, '默认课时').fill('1.5');
  await typeDialog.getByRole('button', { name: '保存课型' }).click();
  let typeRow = lessonTypeTable.getByRole('row', { name: new RegExp(typeName) });
  await expect(typeRow).toContainText('启用');

  await typeRow.getByRole('button', { name: '编辑课型' }).click();
  const editTypeDialog = page.getByRole('dialog', { name: '编辑课型' });
  await formInput(editTypeDialog, '名称').fill(editedTypeName);
  await editTypeDialog.locator('.el-form-item').filter({ hasText: '启用' }).locator('.el-switch').click();
  await editTypeDialog.getByRole('button', { name: '保存课型' }).click();
  typeRow = lessonTypeTable.getByRole('row', { name: new RegExp(editedTypeName) });
  await expect(typeRow).toContainText('停用');

  await page.getByRole('tab', { name: '排课规则' }).click();
  const ruleTable = page.getByTestId('schedule-rule-table');
  await page.getByTestId('create-rule').click();
  const createRuleDialog = page.getByRole('dialog', { name: '新增排课规则' });
  await selectFormOption(page, createRuleDialog, '班级', 'E2E Browser Class');
  await expect(formInput(createRuleDialog, '课程')).toHaveValue('E2E Browser Course');
  await selectFormOption(page, createRuleDialog, '默认教师', 'E2E Teacher');
  await selectFormOption(page, createRuleDialog, '上课类型', 'E2E 计费正课');
  await createRuleDialog.getByRole('button', { name: '保存规则' }).click();

  const ruleRow = ruleTable.getByRole('row')
    .filter({ hasText: 'E2E Browser Class' })
    .filter({ hasText: '18:00-20:00' });
  await expect(ruleRow).toContainText('启用');
  await expect(ruleRow).toContainText('E2E Browser Course');
  await expect(ruleRow).toContainText('E2E Teacher');
  await ruleRow.getByRole('button', { name: '编辑排课规则' }).click();
  const ruleDialog = page.getByRole('dialog', { name: '编辑排课规则' });
  await selectFormOption(page, ruleDialog, '规则状态', '暂停');
  await ruleDialog.getByRole('button', { name: '保存规则' }).click();
  await expect(ruleRow).toContainText('暂停');

  await ruleRow.getByRole('button', { name: '编辑排课规则' }).click();
  await selectFormOption(page, page.getByRole('dialog', { name: '编辑排课规则' }), '规则状态', '启用');
  await page.getByRole('dialog', { name: '编辑排课规则' }).getByRole('button', { name: '保存规则' }).click();
  await expect(ruleRow).toContainText('启用');

  await ruleRow.getByRole('button', { name: '编辑排课规则' }).click();
  await selectFormOption(page, page.getByRole('dialog', { name: '编辑排课规则' }), '规则状态', '归档');
  await page.getByRole('dialog', { name: '编辑排课规则' }).getByRole('button', { name: '保存规则' }).click();
  await expect(ruleRow).toContainText('归档');
});

test('Gate D completes reschedule, makeup, cancellation, material change, attendance, reversal, and learner visibility through clicks', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const studentPage = await studentContext.newPage();

  await login(adminPage, 'e2e_admin');
  await adminPage.goto('/teaching-operations');
  await expect(adminPage.getByRole('heading', { name: '教学运营' })).toBeVisible();
  await adminPage.getByTestId('generate-sessions').click();
  const generateDialog = adminPage.getByRole('dialog', { name: '顺序排课' });
  await expect(generateDialog).toBeVisible();
  await expect(formInput(generateDialog, '课程')).toHaveValue('E2E Browser Course');
  await expect(generateDialog.locator('.sequence-preview')).toContainText('E2E 知识点 1');
  await generateDialog.getByTestId('submit-generate').click();
  await expect(adminPage.getByText(/生成 3 节，跳过重复 0 节/)).toBeVisible();

  const sessionRow = await rescheduleGeneratedLesson(adminPage);
  await publishChangedLessonMaterial(adminPage, sessionRow);
  await sessionRow.getByRole('button', { name: '打开考勤' }).click();
  const attendanceRow = adminPage.getByTestId('attendance-table').getByRole('row', { name: /E2E Student/ });
  await attendanceRow.locator('.el-select').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: '出勤' }).click();
  await adminPage.getByTestId('confirm-attendance').click();
  await expect(adminPage.getByText('已确认 1 条，幂等跳过 0 条')).toBeVisible();
  await adminPage.getByTestId('confirm-attendance').click();
  await expect(adminPage.getByText('请选择至少一条尚未确认的考勤')).toBeVisible();

  await adminPage.getByRole('tab', { name: '课时台账' }).click();
  const balanceRow = adminPage.getByTestId('balance-table').getByRole('row', { name: /E2E Student/ });
  await expect(balanceRow).toContainText('4');
  expect(await prisma.lessonHourLedger.count({ where: { student: { username: 'e2e_student' }, type: 'CONSUME' } })).toBe(1);

  await adminPage.getByRole('tab', { name: '考勤确认' }).click();
  const confirmedRow = adminPage.getByTestId('attendance-table').getByRole('row', { name: /E2E Student/ });
  await confirmedRow.getByRole('button', { name: '更正' }).click();
  const correctionDialog = adminPage.getByRole('dialog', { name: '更正考勤' });
  await correctionDialog.locator('.el-select').click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: '请假' }).click();
  const correctionDeductInput = correctionDialog.locator('.el-input-number input');
  await expect(correctionDeductInput).toHaveValue('0');
  await expect(correctionDeductInput).toBeDisabled();
  await correctionDialog.locator('textarea').fill('浏览器验收：核实为已请假');
  await correctionDialog.getByTestId('submit-correction').click();
  const correctionConfirm = adminPage.getByRole('dialog', { name: '确认更正' });
  await correctionConfirm.locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('考勤已更正，冲正台账已追加')).toBeVisible();

  await adminPage.getByRole('tab', { name: '课时台账' }).click();
  await expect(balanceRow).toContainText('5');
  expect(await prisma.lessonHourLedger.count({ where: { student: { username: 'e2e_student' }, type: 'REVERSAL' } })).toBe(1);
  await adminPage.getByTestId('reconcile-hours').click();
  await expect(adminPage.getByText(/核对通过：.*名学生差异为 0/)).toBeVisible();

  await login(studentPage, 'e2e_student');
  await studentPage.goto('/teaching-operations');
  await expect(studentPage.getByRole('heading', { name: '教学运营' })).toBeVisible();
  await expect(studentPage.getByRole('tab', { name: '排课规则' })).toBeVisible();
  await expect(studentPage.getByRole('tab', { name: '课型设置' })).toHaveCount(0);
  await studentPage.getByRole('tab', { name: '排课规则' }).click();
  await expect(studentPage.getByTestId('schedule-rule-table')).toBeVisible();
  await expect(studentPage.getByTestId('create-rule')).toHaveCount(0);
  await studentPage.getByRole('tab', { name: '课时台账' }).click();
  await expect(studentPage.getByTestId('balance-table').getByRole('row', { name: /E2E Student/ })).toContainText('5');
  await expect(studentPage.getByRole('button', { name: '登记课时变动' })).toHaveCount(0);
  await studentPage.goto('/learning-portal');
  const portalRow = studentPage.getByTestId('portal-lessons').getByRole('row')
    .filter({ hasText: 'E2E 知识点 1' }).filter({ hasText: '调课后实际讲授内容' });
  await expect(portalRow).toBeVisible();
  await portalRow.getByTestId('open-portal-lesson').click();
  await expect(studentPage.getByText('素材已由 v1 替换为 v2', { exact: true })).toBeVisible();
  await expect(studentPage.getByTestId('portal-assets')).toContainText('lesson-material-v2.txt');
  await expect(studentPage.getByTestId('portal-assets')).not.toContainText('lesson-material-v1.txt');

  await adminContext.close();
  await studentContext.close();
});

test('material context keeps child answers independent and rubric grading is available in the browser', async ({ browser }) => {
  const student = await browser.newContext();
  const admin = await browser.newContext();
  const studentPage = await student.newPage();
  const adminPage = await admin.newPage();
  await login(studentPage, 'e2e_student');
  await studentPage.goto(`/student/exams/${materialExamId}`);
  await expect(studentPage.getByText('E2E shared material context', { exact: true })).toBeVisible();
  await expect(studentPage.getByRole('heading', { name: 'E2E material child choice' })).toBeVisible();
  await studentPage.getByText('Correct material option', { exact: true }).click();
  await studentPage.getByRole('button', { name: '下一题' }).click();
  await expect(studentPage.getByRole('heading', { name: 'E2E rubric child' })).toBeVisible();
  await studentPage.getByPlaceholder('填写答案').fill('A clear browser explanation');
  await studentPage.locator('.aside-actions').getByRole('button', { name: '提交试卷', exact: true }).click();
  const confirmation = studentPage.getByRole('dialog', { name: '确认提交' });
  await expect(confirmation).toBeVisible();
  await confirmation.locator('.el-message-box__btns .el-button--primary').click();
  await expect(studentPage).toHaveURL(/\/student\/attempts\/.+\/result$/, { timeout: 20_000 });

  await login(adminPage, 'e2e_admin');
  await ensureE2eAiConfigurations(adminPage);
  await adminPage.goto('/grading');
  await adminPage.locator('.grading-filters .el-select').first().click();
  const examOption = adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E material rubric exam' });
  await expect(examOption).toBeVisible();
  await examOption.click();
  await expect(adminPage.getByText('E2E rubric child', { exact: true })).toBeVisible();
  await adminPage.getByText('E2E rubric child', { exact: true }).click();
  await expect(adminPage.getByText('准确性（5 分）', { exact: true })).toBeVisible();
  const rubricInputs = adminPage.locator('.rubric-row .el-input-number input');
  await rubricInputs.nth(0).fill('5');
  await rubricInputs.nth(1).fill('2');
  await adminPage.getByRole('button', { name: '保存并批改下一题' }).click();
  await expect(adminPage.getByText(/整份试卷已完成批改|已保存/)).toBeVisible();

  await adminPage.getByRole('button', { name: '试算重判' }).click();
  await adminPage.getByRole('button', { name: '生成试算' }).click();
  await expect(adminPage.getByText('试算完成，正式成绩尚未改变')).toBeVisible();
  await expect(adminPage.getByText('扫描答案')).toBeVisible();

  await adminPage.goto('/statistics');
  const examRow = adminPage.getByRole('row', { name: /E2E material rubric exam/ });
  await expect(examRow).toBeVisible();
  await examRow.getByRole('button', { name: 'AI 总结' }).click();
  const aiDialog = adminPage.getByRole('dialog', { name: /AI 考试 · E2E material rubric exam/ });
  await expect(aiDialog).toBeVisible();
  await expect(aiDialog.getByText('统计预览始终来自确定性查询')).toBeVisible();
  await expect(aiDialog.getByText('本次输出上限（可选）')).toBeVisible();
  const modelSelectors = aiDialog.locator('.ai-model-selector .el-select');
  await modelSelectors.first().click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: /^qwen（/ }).click();
  await modelSelectors.nth(1).click();
  await adminPage.locator('.el-select-dropdown__item:visible', { hasText: 'E2E Manual Model' }).click();
  await expect(aiDialog.getByPlaceholder('自动')).toHaveValue('');
  await expect(aiDialog.getByText('尚未生成总结')).toBeVisible();
  await expect(aiDialog.getByText('模型调用')).toHaveCount(0);
  await aiDialog.getByRole('button', { name: '生成/复用草稿' }).click();
  await expect(adminPage.getByText('考试草稿已生成')).toBeVisible();
  await expect(aiDialog.getByRole('heading', { name: '总结草稿 · v1' })).toBeVisible();
  const headline = aiDialog.getByLabel('核心结论');
  await expect(headline).toHaveValue('E2E 模型生成的可审核结论');
  await headline.fill('浏览器人工编辑后的总结结论');
  await aiDialog.getByRole('button', { name: '保存编辑' }).click();
  await expect(adminPage.getByText('草稿已保存，旧审核状态已清除')).toBeVisible();
  await aiDialog.getByRole('button', { name: '审核通过' }).click();
  await expect(adminPage.getByText('人工审核已通过')).toBeVisible();
  await aiDialog.getByRole('button', { name: '发布' }).click();
  await adminPage.getByRole('dialog', { name: '确认发布' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('考试已发布')).toBeVisible();

  await studentPage.goto('/learning-portal?tab=summaries');
  await expect(studentPage.getByText('浏览器人工编辑后的总结结论', { exact: true })).toBeVisible();
  await aiDialog.getByRole('button', { name: '撤回' }).click();
  await adminPage.getByRole('dialog', { name: '确认撤回' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(adminPage.getByText('考试已撤回')).toBeVisible();
  await studentPage.reload();
  await expect(studentPage.getByText('浏览器人工编辑后的总结结论', { exact: true })).toHaveCount(0);
  await mkdir('output/playwright', { recursive: true });
  await aiDialog.screenshot({ path: 'output/playwright/ai-exam-summary-dialog.png' });
  await admin.close();
  await student.close();
});

test('Stage 7 fused dashboard and AI academic entry points work through browser clicks', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const studentPage = await studentContext.newPage();
  const parentPage = await parentContext.newPage();

  await login(adminPage, 'e2e_admin');
  await adminPage.goto('/classes');
  await adminPage.getByText('E2E Browser Class', { exact: true }).first().click();
  await adminPage.getByRole('button', { name: 'AI 班级总结' }).click();
  const classDialog = adminPage.getByRole('dialog', { name: /AI 班级 · E2E Browser Class/ });
  await expect(classDialog.getByText('class_aggregate_only')).toBeVisible();
  await expect(classDialog.getByText('v2', { exact: true })).toBeVisible();
  await classDialog.locator('.el-dialog__headerbtn').click();

  await adminPage.getByRole('button', { name: '家长报告' }).click();
  const parentReportDialog = adminPage.getByRole('dialog', { name: /AI 家长报告 · E2E Student/ });
  await expect(parentReportDialog.getByText('submitted_exams_with_score_visibility_policy')).toBeVisible();
  await parentReportDialog.locator('.el-dialog__headerbtn').click();

  await adminPage.goto('/ai-settings');
  await expect(adminPage.getByRole('heading', { name: 'AI 中心' })).toBeVisible();
  await adminPage.getByRole('tab', { name: '质量与回归' }).click();
  await expect(adminPage.getByRole('heading', { name: 'AI 质量、成本与回归' })).toBeVisible();
  await adminPage.getByRole('tab', { name: '模型切换回归' }).click();
  await expect(adminPage.getByRole('button', { name: '执行回归' })).toBeVisible();

  await login(studentPage, 'e2e_student');
  await expect(studentPage).toHaveURL(/\/dashboard$/);
  await expect(studentPage.getByRole('heading', { name: '测评 · 教务融合看板' })).toBeVisible();
  await studentPage.getByRole('link', { name: /考试记录/ }).click();
  await expect(studentPage).toHaveURL(/\/learning-portal\?tab=exams$/);
  await expect(studentPage.getByRole('tab', { name: '考试记录' })).toHaveAttribute('aria-selected', 'true');
  await studentPage.goto('/dashboard');
  await studentPage.getByRole('link', { name: /课时台账/ }).click();
  await expect(studentPage).toHaveURL(/\/teaching-operations\?tab=ledger$/);
  await expect(studentPage.getByRole('tab', { name: '课时台账' })).toHaveAttribute('aria-selected', 'true');

  await login(parentPage, 'e2e_parent');
  await expect(parentPage).toHaveURL(/\/dashboard$/);
  await expect(parentPage.getByText('已关联学生')).toBeVisible();
  await expect(parentPage.getByRole('link', { name: /考试记录/ })).toBeVisible();

  await adminContext.close();
  await studentContext.close();
  await parentContext.close();
});

test('Stage 8 Scratch classroom runs teacher, student and parent clicks without overwriting versions', async ({ browser }) => {
  test.setTimeout(120_000);
  const [teacherUser, studentUser, parentUser] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: 'e2e_teacher' } }),
    prisma.user.findUniqueOrThrow({ where: { username: 'e2e_student' } }),
    prisma.user.findUniqueOrThrow({ where: { username: 'e2e_parent' } }),
  ]);
  await prisma.classTeacher.upsert({
    where: { classId_teacherId: { classId, teacherId: teacherUser.id } },
    update: { status: 'ACTIVE', leftAt: null },
    create: { classId, teacherId: teacherUser.id, role: 'LEAD' },
  });
  await prisma.classStudent.upsert({
    where: { classId_studentId: { classId, studentId: studentUser.id } },
    update: { status: 'ACTIVE', leftAt: null },
    create: { classId, studentId: studentUser.id },
  });
  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parentUser.id, studentId: studentUser.id } },
    update: { relationship: '监护人', isPrimary: true },
    create: { parentId: parentUser.id, studentId: studentUser.id, relationship: '监护人', isPrimary: true },
  });

  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  const studentPage = await studentContext.newPage();
  const parentPage = await parentContext.newPage();
  const projectTemplate = await createScratchProjectBuffer({ label: 'e2e-template' });
  const projectWork = await createScratchProjectBuffer({ label: 'e2e-student-v2' });
  const templateTitle = `E2E Scratch 模板 ${Date.now()}`;
  const assignmentTitle = `E2E Scratch 任务 ${Date.now()}`;

  await login(teacherPage, 'e2e_teacher');
  await teacherPage.goto('/teaching-operations');
  const sessionRow = teacherPage.getByTestId('session-table').getByRole('row', { name: /E2E Scratch 课堂/ });
  await expect(sessionRow).toBeVisible();
  await sessionRow.getByTestId('open-lesson-record').click();
  const lessonEditor = teacherPage.getByTestId('lesson-record-editor');
  await expect(lessonEditor).toBeVisible();
  await lessonEditor.getByRole('tab', { name: 'Scratch 课堂' }).click();
  const teacherPanel = teacherPage.getByTestId('scratch-classroom-panel');
  await expect(teacherPanel).toBeVisible();
  await teacherPanel.getByPlaceholder('模板名称').fill(templateTitle);
  await teacherPanel.locator('input[type="file"]').first().setInputFiles({
    name: 'e2e-template.sb3', mimeType: 'application/x.scratch.sb3', buffer: projectTemplate,
  });
  await teacherPanel.getByTestId('create-scratch-template').click();
  await expect(teacherPanel.getByText(templateTitle, { exact: true }).last()).toBeVisible();
  await teacherPanel.getByTestId('scratch-assignment-title').fill(assignmentTitle);
  await teacherPanel.getByTestId('create-scratch-assignment').click();
  await expect(teacherPanel.getByText(assignmentTitle, { exact: true })).toBeVisible();
  await teacherPanel.getByText(assignmentTitle, { exact: true }).click();
  await teacherPanel.getByTestId('publish-scratch-assignment').click();
  await teacherPage.locator('.el-message-box__btns .el-button--primary').click();
  await expect(teacherPanel.getByText('已发布', { exact: true })).toBeVisible();

  await login(studentPage, 'e2e_student');
  await studentPage.goto('/learning-portal?tab=scratch');
  const studentPanel = studentPage.getByTestId('scratch-learning-panel');
  await expect(studentPanel.getByText(assignmentTitle, { exact: true })).toBeVisible();
  await studentPanel.getByTestId('open-student-scratch-work').click();
  const studentDrawer = studentPage.getByTestId('scratch-work-learning-drawer');
  await expect(studentDrawer).toContainText(assignmentTitle);
  await studentDrawer.locator('input[type="file"]').setInputFiles({
    name: 'e2e-work-v2.sb3', mimeType: 'application/x.scratch.sb3', buffer: projectWork,
  });
  await studentDrawer.getByTestId('save-scratch-version').click();
  await expect(studentDrawer.getByTestId('student-scratch-versions').getByText('v2', { exact: true })).toBeVisible();
  await studentDrawer.getByTestId('submit-scratch-work').click();
  await studentPage.locator('.el-message-box__btns .el-button--primary').click();
  await expect(studentDrawer).toContainText('已提交');
  await expect(studentDrawer.getByTestId('student-scratch-versions').getByText('v3', { exact: true })).toBeVisible();

  await teacherPanel.getByRole('button', { name: '刷新' }).click();
  const openTeacherWork = teacherPanel.getByTestId('open-scratch-work');
  if (!await openTeacherWork.isVisible()) {
    await teacherPanel.locator('.el-collapse-item__header').filter({ hasText: assignmentTitle }).click();
  }
  await expect(openTeacherWork).toBeVisible();
  await openTeacherWork.dispatchEvent('click');
  const teacherWorkDrawer = teacherPage.getByTestId('scratch-work-review-drawer');
  await expect(teacherWorkDrawer).toBeVisible();
  await teacherWorkDrawer.getByTestId('scratch-review-score').locator('input').fill('95');
  await teacherWorkDrawer.getByPlaceholder('教师点评').fill('浏览器闭环批阅通过');
  await teacherWorkDrawer.getByTestId('submit-scratch-review').click();
  await expect(teacherWorkDrawer.getByText('95 分', { exact: true })).toBeVisible();

  await studentDrawer.locator('.el-drawer__close-btn').click();
  await studentPanel.getByRole('button', { name: '刷新' }).click();
  await studentPanel.getByTestId('open-student-scratch-work').click();
  const refreshedStudentDrawer = studentPage.getByTestId('scratch-work-learning-drawer');
  await expect(refreshedStudentDrawer.getByText('教师批阅：95 分', { exact: true })).toBeVisible();
  await expect(refreshedStudentDrawer.getByText('浏览器闭环批阅通过', { exact: true })).toBeVisible();

  await login(parentPage, 'e2e_parent');
  await parentPage.goto('/learning-portal?tab=scratch');
  const parentPanel = parentPage.getByTestId('scratch-learning-panel');
  await expect(parentPanel.getByText('家长可查看已产生的作品版本、判定和教师点评，不能代替学生保存或提交。')).toBeVisible();
  await parentPanel.getByTestId('open-student-scratch-work').click();
  const parentDrawer = parentPage.getByTestId('scratch-work-learning-drawer');
  await expect(parentDrawer.getByText('教师批阅：95 分', { exact: true })).toBeVisible();
  await expect(parentDrawer.getByTestId('save-scratch-version')).toHaveCount(0);

  const versions = await prisma.scratchWorkVersion.findMany({
    where: { work: { assignment: { title: assignmentTitle }, studentId: studentUser.id } },
    orderBy: { version: 'asc' },
  });
  expect(versions.map((item) => item.version)).toEqual([1, 2, 3]);

  await teacherContext.close();
  await studentContext.close();
  await parentContext.close();
});

async function createE2eAiConfiguration(page: Page, options: {
  presetName: RegExp;
  name: string;
  scope: 'system' | 'personal';
  isDefault: boolean;
}) {
  await page.getByRole('button', { name: options.presetName }).click();
  const dialog = page.getByRole('dialog', { name: '新增 AI 配置' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('配置名称').fill(options.name);
  await dialog.getByLabel('API Key').fill(`e2e-only-${options.name.toLowerCase().replace(/\s+/g, '-')}`);
  if (options.scope === 'personal') await dialog.getByText('仅自己', { exact: true }).click();
  if (options.isDefault) await dialog.locator('.ai-default-switch').click();
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: new RegExp(options.name) })).toBeVisible();
}

async function ensureE2eAiConfigurations(page: Page) {
  await page.goto('/ai-settings');
  await expect(page.getByRole('heading', { name: 'AI 中心' })).toBeVisible();
  await expect(page.locator('.ai-preset-card')).toHaveCount(9);
  const configurations = [
    { presetName: /^DeepSeek /, name: 'E2E Default Model', scope: 'system' as const, isDefault: true },
    { presetName: /^阿里云百炼/, name: 'E2E Manual Model', scope: 'personal' as const, isDefault: false },
  ];
  for (const configuration of configurations) {
    if (await page.getByRole('row', { name: new RegExp(configuration.name) }).count() === 0) {
      await createE2eAiConfiguration(page, configuration);
    }
  }
}

async function rescheduleGeneratedLesson(page: Page) {
  const table = page.getByTestId('session-table');
  const originalRow = table.getByRole('row', { name: /E2E 知识点 1/ });
  await expect(originalRow).toContainText('E2E 知识点 1');
  await originalRow.getByRole('button', { name: '调课' }).click();
  const dialog = page.getByRole('dialog', { name: '调整上课安排' });
  const dateInputs = dialog.locator('.el-date-editor input');
  await dateInputs.nth(0).fill(`${operationsDate} 20:00:00`);
  await dateInputs.nth(1).fill(`${operationsDate} 21:00:00`);
  await formInput(dialog, '教室').fill('E2E Changed Lab');
  await dialog.locator('textarea').fill('浏览器验收：临时调整上课时间和教室');
  await dialog.getByTestId('submit-session-change').click();
  await expect(page.getByText('调课完成，原课次已保留追溯记录')).toBeVisible();

  const matchingRows = table.getByRole('row').filter({ hasText: 'E2E 知识点 1' });
  await expect(matchingRows).toHaveCount(2);
  const rescheduledOriginal = matchingRows.filter({ hasText: '已调课' });
  await expect(rescheduledOriginal).toBeVisible();
  await rescheduledOriginal.getByRole('button', { name: '创建补课' }).click();
  const makeupDialog = page.getByRole('dialog', { name: '创建补课课次' });
  const makeupDateInputs = makeupDialog.locator('.el-date-editor input');
  await makeupDateInputs.nth(0).fill(`${operationsDate} 22:00:00`);
  await makeupDateInputs.nth(1).fill(`${operationsDate} 23:00:00`);
  await formInput(makeupDialog, '教室').fill('E2E Makeup Lab');
  await makeupDialog.locator('textarea').fill('浏览器验收：为原调课记录建立补课');
  await makeupDialog.getByTestId('submit-session-change').click();
  await expect(page.getByText('补课课次已创建')).toBeVisible();

  const rowsAfterMakeup = table.getByRole('row').filter({ hasText: 'E2E 知识点 1' });
  await expect(rowsAfterMakeup).toHaveCount(3);
  const makeup = rowsAfterMakeup.filter({ hasText: 'E2E Makeup Lab' });
  await makeup.getByRole('button', { name: '取消课次' }).click();
  const cancelDialog = page.getByRole('dialog', { name: '取消课次' });
  await cancelDialog.locator('input').fill('浏览器验收：补课安排取消');
  await cancelDialog.locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('课次已取消，可从原记录创建补课')).toBeVisible();
  await expect(rowsAfterMakeup.filter({ hasText: 'E2E Makeup Lab' })).toContainText('已取消');

  const replacement = rowsAfterMakeup.filter({ hasText: 'E2E Changed Lab' });
  await expect(replacement).toContainText('待上课');
  await expect(replacement).toContainText('E2E Changed Lab');
  await expect(replacement).toContainText('20:00');
  return replacement;
}

async function publishChangedLessonMaterial(page: Page, sessionRow: Locator) {
  await sessionRow.getByTestId('open-lesson-record').click();
  const editor = page.getByTestId('lesson-record-editor');
  const drawer = page.locator('.el-drawer').filter({ has: editor });
  await expect(editor).toBeVisible();
  await lessonRecordField(editor, '本节课内容').fill('课程原始讲授内容');
  await lessonRecordField(editor, '学习材料说明').fill('原始素材说明');
  await editor.getByTestId('save-lesson-record').click();
  await expect(page.getByText('教学记录草稿已保存')).toBeVisible();

  await editor.getByRole('tab', { name: '课次附件' }).click();
  await drawer.locator('input[type="file"]').setInputFiles({
    name: 'lesson-material-v1.txt', mimeType: 'text/plain', buffer: Buffer.from('material version one'),
  });
  await editor.getByTestId('upload-lesson-asset').click();
  await expect(page.getByText('附件已上传，记录已退回草稿')).toBeVisible();
  const firstAsset = editor.getByTestId('lesson-asset-table').getByRole('row', { name: /lesson-material-v1.txt/ });
  await firstAsset.getByRole('button', { name: '移除' }).click();
  const removeDialog = page.getByRole('dialog', { name: '移除附件' });
  await removeDialog.locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('附件已移除，记录已退回草稿')).toBeVisible();

  await drawer.locator('input[type="file"]').setInputFiles({
    name: 'lesson-material-v2.txt', mimeType: 'text/plain', buffer: Buffer.from('material version two'),
  });
  await editor.getByTestId('upload-lesson-asset').click();
  await expect(editor.getByTestId('lesson-asset-table')).toContainText('lesson-material-v2.txt');
  await expect(editor.getByTestId('lesson-asset-table')).not.toContainText('lesson-material-v1.txt');

  await editor.getByRole('tab', { name: '学生/家长可见' }).click();
  await lessonRecordField(editor, '本节课内容').fill('调课后实际讲授内容');
  await lessonRecordField(editor, '学习材料说明').fill('素材已由 v1 替换为 v2');
  const [saveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/lesson-records/') && response.url().endsWith('/draft')),
    editor.getByTestId('save-lesson-record').click(),
  ]);
  expect(saveResponse.ok()).toBeTruthy();
  await editor.getByTestId('submit-lesson-record').click();
  await page.getByRole('dialog', { name: '提交教学记录' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('教学记录已提交')).toBeVisible();
  await editor.getByTestId('publish-lesson-record').click();
  await page.getByRole('dialog', { name: '发布教学记录' }).locator('.el-message-box__btns .el-button--primary').click();
  await expect(page.getByText('教学记录已发布，通知已发送')).toBeVisible();
  await editor.getByRole('tab', { name: '版本历史' }).click();
  await expect(editor.getByTestId('lesson-record-versions')).toContainText('移除附件');
  await drawer.locator('.el-drawer__close-btn').click();
  await expect(editor).not.toBeVisible();
}

function lessonRecordField(editor: Locator, label: string) {
  return editor.locator('.el-form-item').filter({ hasText: label }).first().locator('textarea');
}

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  await page.waitForLoadState('networkidle');
}

function formInput(container: Locator, label: string) {
  return container.locator('.el-form-item').filter({ hasText: label }).first().locator('input').first();
}

function formSelect(container: Locator, label: string) {
  return container.locator('.el-form-item').filter({ hasText: label }).first().locator('.el-select');
}

async function selectFormOption(page: Page, container: Locator, label: string, option: string) {
  await formSelect(container, label).click();
  await page.locator('.el-select-dropdown__item:visible').filter({ hasText: option }).first().click();
}

async function captureExportDownload(page: Page, clickDownload: () => Promise<void>) {
  let resolveCapture!: (value: { headers: Record<string, string>; body: Buffer }) => void;
  const capture = new Promise<{ headers: Record<string, string>; body: Buffer }>((resolve) => {
    resolveCapture = resolve;
  });
  await page.route('**/api/v1/exports/*/download', async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    resolveCapture({ headers: response.headers(), body });
    await route.fulfill({ response, body });
  }, { times: 1 });
  await clickDownload();
  return capture;
}

async function api(
  request: APIRequestContext,
  method: 'get' | 'post',
  path: string,
  token?: string,
  data?: Record<string, unknown>,
) {
  const response = await request.fetch(`${apiBaseUrl}${path}`, {
    method: method.toUpperCase(),
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const payload = await response.json();
  expect(response.ok(), `${method.toUpperCase()} ${path}: ${JSON.stringify(payload)}`).toBeTruthy();
  return payload.data;
}

async function seedExamSummaryPrompt(adminId: string) {
  await prisma.aiSummaryPromptTemplate.create({
    data: {
      code: 'exam-summary',
      summaryType: AiSummaryType.EXAM,
      version: 1,
      systemPrompt: '仅依据输入数据生成带证据引用的考试总结，并严格返回指定 JSON 结构。',
      outputSchema: EXAM_SUMMARY_OUTPUT_SCHEMA as unknown as Prisma.InputJsonValue,
      enabled: true,
      reviewedBy: adminId,
      createdBy: adminId,
      changeReason: 'Playwright deterministic AI lifecycle fixture',
    },
  });
}

async function seedExportExamFixture(
  request: APIRequestContext,
  token: string,
  fixture: { adminId: string; courseId: string; paperId: string; questionId: string; studentId: string },
) {
  const exam = await api(request, 'post', '/exams', token, {
    paperId: fixture.paperId,
    name: exportExamName,
    courseId: fixture.courseId,
    startTime: new Date(Date.now() - 60_000).toISOString(),
    endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
    durationMinutes: 30,
    attemptLimit: 1,
    showScoreMode: 'after_submit',
  });
  const paperInstance = await prisma.paperInstance.create({
    data: {
      examId: exam.id,
      studentId: fixture.studentId,
      paperSnapshotJson: { schemaVersion: 'e2e-export/v1', paperId: fixture.paperId },
      questionOrderJson: [fixture.questionId],
      optionOrderJson: { [fixture.questionId]: ['A', 'B'] },
    },
  });
  const submittedAt = new Date();
  const attempt = await prisma.examAttempt.create({
    data: {
      examId: exam.id,
      studentId: fixture.studentId,
      userId: fixture.studentId,
      paperInstanceId: paperInstance.id,
      status: AttemptStatus.GRADED,
      submittedAt,
      objectiveScore: 5,
      totalScore: 5,
      durationSeconds: 60,
    },
  });
  await prisma.answerRecord.create({
    data: {
      attemptId: attempt.id,
      questionId: fixture.questionId,
      answerJson: { selected: ['A'] },
      isCorrect: true,
      score: 5,
      status: AnswerRecordStatus.AUTO_GRADED,
      manualComment: 'E2E export fixture grading record',
      gradedBy: fixture.adminId,
      gradedAt: submittedAt,
    },
  });
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE item RECORD;
    BEGIN
      FOR item IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE "' || item.tablename || '" RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}
