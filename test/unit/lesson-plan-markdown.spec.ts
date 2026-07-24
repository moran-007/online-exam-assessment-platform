import {
  inferLessonPlanCodeLanguage,
  normalizeLessonPlanMarkdown,
} from '../../frontend/src/features/lesson-records/composables/lessonPlanMarkdown';

describe('lesson plan Markdown normalization', () => {
  it('keeps short identifiers, keywords, operators and expressions inline', () => {
    const source = '关键字 `if`、`for`，变量 `count`，运算符 `&&`，表达式 `a + b`，声明 `int a;`。';

    expect(normalizeLessonPlanMarkdown(source)).toBe(source);
  });

  it.each([
    ['cpp', '#include <iostream> using namespace std; int main() { cout << "Hi"; return 0; }'],
    ['python', 'def greet(name): return f"Hello, {name}"'],
    ['java', 'public class App { public static void main(String[] args) { System.out.println("Hi"); } }'],
    ['javascript', 'const sum = (a, b) => a + b; console.log(sum(1, 2));'],
    ['sql', 'SELECT id, name FROM students WHERE score >= 90 ORDER BY score DESC;'],
    ['html', '<div class="card"><strong>课程名称</strong><p>教学内容</p></div>'],
    ['css', '.card { display: flex; padding: 8px; color: #123456; }'],
  ] as const)('promotes a complete %s snippet to a language-labelled fence', (language, code) => {
    const normalized = normalizeLessonPlanMarkdown(`示例代码：\`${code}\``);

    expect(normalized).toContain(`\`\`\`${language}\n${code}\n\`\`\``);
    expect(inferLessonPlanCodeLanguage(code)).toBe(language);
  });

  it('promotes a longer C++ statement group but keeps a short declaration inline', () => {
    const longCode = 'int a = 3, b = 4; bool result = (a + b > 5) && (b % 2 != 1);';
    const source = `变量声明 \`int a;\`，完整示例 \`${longCode}\``;
    const normalized = normalizeLessonPlanMarkdown(source);

    expect(normalized).toContain('`int a;`');
    expect(normalized).toContain(`\`\`\`cpp\n${longCode}\n\`\`\``);
  });

  it('leaves existing backtick and tilde fenced blocks byte-for-byte unchanged', () => {
    const fencedWithBackticks = [
      '```cpp',
      'int main() {',
      '  const char* value = "`inline-looking`";',
      '  return 0;',
      '}',
      '```',
    ].join('\n');
    const fencedWithTildes = ['~~~python', 'print(`not-valid-python-but-unchanged`)', '~~~'].join('\n');
    const source = `${fencedWithBackticks}\n\n${fencedWithTildes}`;

    expect(normalizeLessonPlanMarkdown(source)).toBe(source);
  });

  it('normalizes eligible code outside a fence without touching the fence', () => {
    const existingFence = ['```javascript', 'console.log("already fenced");', '```'].join('\n');
    const cpp = 'int main() { std::cout << "new"; return 0; }';
    const normalized = normalizeLessonPlanMarkdown(`${existingFence}\n补充：\`${cpp}\``);

    expect(normalized.startsWith(existingFence)).toBe(true);
    expect(normalized).toContain(`\`\`\`cpp\n${cpp}\n\`\`\``);
  });

  it('does not mistake prose, formulas or unknown command text for code', () => {
    const source = '概念 `变量是存储数据的容器`，公式 `x^2 + y^2 = z^2`，命令 `请观察并回答问题`。';

    expect(normalizeLessonPlanMarkdown(source)).toBe(source);
  });
});
