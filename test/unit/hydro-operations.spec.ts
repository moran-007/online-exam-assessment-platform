import { HydroContext } from '../../src/modules/hydro/hydro.context';
import {
  extractHydroLanguages,
  htmlToMarkdown,
  normalizeHydroLanguage,
} from '../../src/modules/hydro/hydro-html-parser.operations';
import {
  isHydroBotChallenge,
  sanitizeHydroMessage,
} from '../../src/modules/hydro/hydro-http-gateway.operations';
import { parseHydroRecordHtml } from '../../src/modules/hydro/hydro-submission-sync.operations';

const ctx = {
  hydroBotChallengeMessage: 'Hydro 触发人机验证/机器人检测',
} as unknown as HydroContext;

describe('Hydro use-case infrastructure', () => {
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
});
