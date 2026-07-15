import { AnswerRecordStatus, AttemptStatus, HydroAccount } from '@prisma/client';
import { HydroContext } from '../../src/modules/hydro/hydro.context';
import { PullHydroProblemDto, SubmitHydroCodeDto } from '../../src/modules/hydro/dto/hydro.dto';
import {
  extractHydroLanguages,
  htmlToMarkdown,
  normalizeHydroLanguage,
} from '../../src/modules/hydro/hydro-html-parser.operations';
import {
  isHydroBotChallenge,
  sanitizeHydroMessage,
  submitToHydro,
  testHydroAccountLogin,
} from '../../src/modules/hydro/hydro-http-gateway.operations';
import { pullProblem } from '../../src/modules/hydro/hydro-problem.operations';
import {
  parseHydroRecordHtml,
  syncPendingSubmissions,
} from '../../src/modules/hydro/hydro-submission-sync.operations';
import { applyJudgeResult } from '../../src/modules/hydro/hydro-judge-writeback.operations';

const ctx = {
  hydroBotChallengeMessage: 'Hydro 触发人机验证/机器人检测',
} as unknown as HydroContext;

const originalFetch = global.fetch;
const account = {
  id: 'account-1',
  studentId: 'student-1',
  platformUserId: 'student-1',
  platformCode: 'hydro',
  platformName: 'Hydro',
  platformBaseUrl: 'https://hydro.example',
  hydroUserId: 'student',
  hydroUsername: 'student',
  loginUsername: 'student',
  loginPasswordCiphertext: 'ciphertext',
  loginPasswordIv: 'iv',
  loginPasswordAuthTag: 'tag',
  loginPasswordKeyVersion: 1,
  lastLoginStatus: null,
  lastLoginMessage: null,
  lastLoginAt: null,
  bindStatus: 'bound',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as HydroAccount;

function response(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, { status, headers });
}

function hydroContext(overrides: Record<string, unknown> = {}) {
  return {
    hydroBotChallengeMessage: 'Hydro 触发人机验证/机器人检测',
    credentialCipher: {
      decrypt: jest.fn().mockReturnValue('credential-for-test'),
      needsRotation: jest.fn().mockReturnValue(false),
    },
    metrics: { recordHydro: jest.fn() },
    prisma: {
      hydroAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...account, ...data })),
      },
    },
    ...overrides,
  } as unknown as HydroContext;
}

describe('Hydro use-case infrastructure', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('detects Cerberus and localized robot challenges without treating normal pages as blocked', () => {
    expect(isHydroBotChallenge(ctx, '<title>Making sure you\'re not a bot!</title>', '/challenge')).toBe(true);
    expect(isHydroBotChallenge(ctx, '<h1>请完成人机验证</h1>')).toBe(true);
    expect(isHydroBotChallenge(ctx, '<title>Problem 1000</title>', '/p/1000')).toBe(false);
    expect(sanitizeHydroMessage(ctx, '<h1>机器人检测</h1>', 'fallback')).toBe(ctx.hydroBotChallengeMessage);
  });

  it('normalizes languages and parses available Hydro language ids', () => {
    const html = '<select name="language"><option value="cc.cc17o2">C++ 17</option><option value="py.py3">Python 3</option><option value="bad url">Bad</option></select>';
    expect(extractHydroLanguages(ctx, html, {})).toEqual(['cc.cc17o2', 'py.py3']);
    expect(normalizeHydroLanguage(ctx, 'cpp17', ['cc.cc17o2', 'py.py3'])).toBe('cc.cc17o2');
    expect(normalizeHydroLanguage(ctx, 'python3', ['cc.cc17o2', 'py.py3'])).toBe('py.py3');
  });

  it('converts statements and parses a final accepted record', () => {
    const markdown = htmlToMarkdown(ctx, '<h2>题目描述</h2><p>Hello &amp; Hydro</p><pre><code class="language-cpp">int main() {}</code></pre>');
    expect(markdown).toContain('## 题目描述');
    expect(markdown).toContain('Hello & Hydro');
    expect(markdown).toContain('```cpp');

    const record = parseHydroRecordHtml(ctx, `
      <span class="record-status--text">Accepted</span>
      <dl id="summary"><dt>分数</dt><dd>100</dd><dt>评测时间</dt><dd><span data-timestamp="1700000000"></span></dd></dl>
      <tr class="case"><td><span class="record-status--text">Accepted</span></td></tr>
      <tr class="case"><td><span class="record-status--text">Accepted</span></td></tr>
    `, '42', 'https://hydro.example/record/42');
    expect(record).toMatchObject({ status: 'accepted', score: 100, passedTestCaseCount: 2, totalTestCaseCount: 2, final: true });
    expect(record.judgedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('logs in with an encrypted credential and persists a successful status', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('<form>login</form>'))
      .mockResolvedValueOnce(response('', 302, { location: '/', 'set-cookie': 'sid=session-id; Path=/' }));
    const loginContext = hydroContext();

    const result = await testHydroAccountLogin(loginContext, account);

    expect(result).toMatchObject({ success: true, status: 'success' });
    expect(loginContext.credentialCipher.decrypt).toHaveBeenCalledWith(
      expect.objectContaining({ ciphertext: 'ciphertext', keyVersion: 1 }),
      'hydro-account',
    );
    expect(loginContext.prisma.hydroAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastLoginStatus: 'success' }),
    }));
  });

  it('stops at a robot challenge and persists the blocked strategy', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(response("<title>Making sure you're not a bot!</title>"));
    const blockedContext = hydroContext();

    const result = await testHydroAccountLogin(blockedContext, account);

    expect(result).toMatchObject({ success: false, status: 'blocked' });
    expect(blockedContext.prisma.hydroAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastLoginStatus: 'blocked' }),
    }));
    expect(blockedContext.metrics.recordHydro).toHaveBeenCalledWith('bot_challenge', 'blocked');
  });

  it('pulls and normalizes a public Hydro problem', async () => {
    const pageContext = JSON.stringify({
      problemId: 'P1000',
      domainId: 'system',
      pdoc: {
        pid: 'P1000',
        title: 'A+B Problem',
        content: { zh: '<h2>题目描述</h2><p>计算两个整数之和。</p>' },
        config: { langs: ['cc.cc17o2', 'py.py3'], timeMax: 1000, memoryMax: 128 },
      },
    });
    global.fetch = jest.fn().mockResolvedValueOnce(response(`<script>window.UiContextNew = '${pageContext}';</script>`));
    const pullContext = hydroContext();

    const result = await pullProblem(pullContext, {
      problemId: 'P1000',
      platformBaseUrl: 'https://hydro.example',
    } as PullHydroProblemDto);

    expect(result).toMatchObject({
      type: 'programming',
      title: 'A+B Problem',
      externalProblemId: 'P1000',
      externalProblemUrl: 'https://hydro.example/p/P1000',
      languages: ['cc.cc17o2', 'py.py3'],
      timeLimit: 1000,
      memoryLimit: 128,
    });
    expect(result.content).toContain('计算两个整数之和');
  });

  it('submits code and reads the final Hydro record without extra polling', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('<form>login</form>'))
      .mockResolvedValueOnce(response('', 302, { location: '/', 'set-cookie': 'sid=session-id; Path=/' }))
      .mockResolvedValueOnce(response('', 302, { location: '/record/42' }))
      .mockResolvedValueOnce(response(`
        <span class="record-status--text">Accepted</span>
        <dl id="summary"><dt>分数</dt><dd>100</dd></dl>
        <tr class="case"><td><span class="record-status--text">Accepted</span></td></tr>
      `));
    const submitContext = hydroContext();

    const result = await submitToHydro(
      submitContext,
      {
        judgeProvider: 'hydro',
        externalProblemId: 'P1000',
        platformBaseUrl: 'https://hydro.example',
        languages: ['cc.cc17o2'],
      },
      { language: 'cc.cc17o2', code: 'int main() { return 0; }' } as SubmitHydroCodeDto,
      account,
      [],
    );

    expect(result).toMatchObject({
      mode: 'direct',
      externalSubmissionId: '42',
      status: 'accepted',
      score: 100,
    });
    expect(submitContext.metrics.recordHydro).toHaveBeenCalledWith('submit', 'judged');
  });

  it('polls pending submissions and persists a non-final remote state', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('<form>login</form>'))
      .mockResolvedValueOnce(response('', 302, { location: '/', 'set-cookie': 'sid=session-id; Path=/' }))
      .mockResolvedValueOnce(response('<span class="record-status--text">Judging</span>'));
    const update = jest.fn().mockResolvedValue({});
    const pollingContext = hydroContext({
      prisma: {
        hydroAccount: {
          findFirst: jest.fn().mockResolvedValue(account),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        judgeSubmission: {
          findMany: jest.fn().mockResolvedValue([{ id: 'submission-1' }]),
          findFirst: jest.fn().mockResolvedValue({
            id: 'submission-1',
            status: 'pending',
            externalSubmissionId: '42',
            resultJson: {
              mode: 'direct',
              hydroAccountId: account.id,
              recordUrl: 'https://hydro.example/record/42',
            },
          }),
          update,
        },
      },
    });

    await syncPendingSubmissions(pollingContext);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'submission-1' },
      data: expect.objectContaining({ status: 'judging' }),
    }));
  });

  it('writes a final judge result back atomically and recalculates the attempt', async () => {
    const transaction = {
      judgeSubmission: { update: jest.fn().mockResolvedValue({}) },
      answerRecord: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ score: 20, status: AnswerRecordStatus.JUDGE_DONE }]),
      },
      examAttempt: {
        findUnique: jest.fn().mockResolvedValue({ status: AttemptStatus.SUBMITTED, submittedAt: new Date() }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const writebackContext = hydroContext({
      prisma: {
        judgeSubmission: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'submission-1',
            attemptId: 'attempt-1',
            questionId: 'question-1',
            studentId: 'student-1',
            externalSubmissionId: '42',
            language: 'cc.cc17o2',
            codeSnapshot: 'int main() { return 0; }',
            resultJson: { mode: 'direct' },
            attempt: {
              examId: 'exam-1',
              paperInstance: {
                paperSnapshotJson: {
                  sections: [{
                    questions: [{
                      questionId: 'question-1',
                      score: 20,
                      snapshot: { id: 'question-1', type: 'programming', title: 'A+B', content: '', answer: {} },
                    }],
                  }],
                },
              },
            },
          }),
        },
        $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
      },
    });

    const result = await applyJudgeResult(writebackContext, {
      submissionId: 'submission-1',
      status: 'accepted',
      score: 100,
      passedTestCaseCount: 2,
      totalTestCaseCount: 2,
      result: { recordUrl: 'https://hydro.example/record/42' },
    });

    expect(result).toMatchObject({ status: 'accepted', score: 20, maxScore: 20, isCorrect: true });
    expect(transaction.judgeSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'accepted', score: 20 }),
    }));
    expect(transaction.answerRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: AnswerRecordStatus.JUDGE_DONE, isCorrect: true, score: 20 }),
    }));
    expect(transaction.examAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AttemptStatus.GRADED, totalScore: 20 }),
    }));
  });
});
