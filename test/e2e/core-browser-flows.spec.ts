import '../setup-env';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PrismaClient, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { mkdir, rm } from 'node:fs/promises';

const prisma = new PrismaClient();
const password = '123456';
const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3100/api/v1';
let examId = '';
let materialExamId = '';
let paperName = '';

test.beforeAll(async ({ request }) => {
  await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
  await resetDatabase();
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({
    data: [
      { username: 'e2e_admin', passwordHash, realName: 'E2E Admin', userType: UserType.SUPER_ADMIN },
      { username: 'e2e_teacher', passwordHash, realName: 'E2E Teacher', userType: UserType.TEACHER },
      { username: 'e2e_student', passwordHash, realName: 'E2E Student', userType: UserType.STUDENT },
    ],
  });

  const login = await api(request, 'post', '/auth/login', undefined, {
    username: 'e2e_admin', password, rememberMe: false,
  });
  const token = login.accessToken as string;
  const course = await api(request, 'post', '/courses', token, {
    name: 'E2E Browser Course', code: 'e2e_browser_course', description: 'Playwright fixture', sortOrder: 1,
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
  await expect(studentPage).toHaveURL(/\/student\/exams$/);

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
  await expect(teacherPage).toHaveURL(/\/ai-settings$/);
  await expect(teacherPage.getByRole('heading', { name: 'AI 模型配置' })).toBeVisible();
  await teacherPage.goto('/external-accounts');
  await expect(teacherPage.getByRole('heading', { name: '外部账号' })).toBeVisible();
  await expect(teacherPage.getByText('我的账号', { exact: true })).toBeVisible();

  await publicContext.close();
  await teacherContext.close();
});

test('privileged users can open AI settings while students are denied', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const studentPage = await studentContext.newPage();

  await login(adminPage, 'e2e_admin');
  await adminPage.goto('/ai-settings');
  await expect(adminPage.getByRole('heading', { name: 'AI 模型配置' })).toBeVisible();
  await expect(adminPage.locator('.ai-preset-card')).toHaveCount(8);
  await adminPage.getByRole('button', { name: /^DeepSeek / }).click();
  await expect(adminPage.getByRole('dialog', { name: '新增 AI 配置' })).toBeVisible();
  await expect(adminPage.getByLabel('Base URL')).toHaveValue('https://api.deepseek.com');

  await login(studentPage, 'e2e_student');
  await studentPage.goto('/ai-settings');
  await expect(studentPage).not.toHaveURL(/\/ai-settings$/);
  await expect(studentPage.getByRole('heading', { name: 'AI 模型配置' })).toHaveCount(0);

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
  const aiDialog = adminPage.getByRole('dialog', { name: /AI 考试总结 · E2E material rubric exam/ });
  await expect(aiDialog).toBeVisible();
  await expect(aiDialog.getByText('统计预览始终来自确定性查询')).toBeVisible();
  await expect(aiDialog.getByText('尚未生成总结')).toBeVisible();
  await expect(aiDialog.getByText('模型调用')).toHaveCount(0);
  await mkdir('output/playwright', { recursive: true });
  await aiDialog.screenshot({ path: 'output/playwright/ai-exam-summary-dialog.png' });
  await admin.close();
  await student.close();
});

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  await page.waitForLoadState('networkidle');
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
