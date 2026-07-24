export const LESSON_PLAN_CODE_LANGUAGES = [
  'cpp',
  'python',
  'java',
  'javascript',
  'sql',
  'html',
  'css',
] as const;

export type LessonPlanCodeLanguage = typeof LESSON_PLAN_CODE_LANGUAGES[number];

type LanguageScores = Record<LessonPlanCodeLanguage, number>;

interface FenceMarker {
  character: '`' | '~';
  length: number;
}

const INLINE_CODE_PATTERN = /(?<!`)`([^`]+)`(?!`)/g;

/**
 * Turns AI output such as `int main() { ... }` into a real Markdown code block.
 *
 * Short identifiers, keywords, operators and small expressions remain inline code.
 * Existing fenced code blocks are copied byte-for-byte.
 */
export function normalizeLessonPlanMarkdown(source: string): string {
  if (!source || !source.includes('`')) return source;

  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
  let activeFence: FenceMarker | undefined;
  let plainText = '';
  let normalized = '';

  const flushPlainText = () => {
    normalized += normalizeInlineCode(plainText);
    plainText = '';
  };

  for (const line of lines) {
    if (activeFence) {
      normalized += line;
      if (isClosingFence(line, activeFence)) activeFence = undefined;
      continue;
    }

    const openingFence = readOpeningFence(line);
    if (openingFence) {
      flushPlainText();
      normalized += line;
      activeFence = openingFence;
      continue;
    }

    plainText += line;
  }

  flushPlainText();
  return normalized;
}

export function inferLessonPlanCodeLanguage(rawCode: string): LessonPlanCodeLanguage | undefined {
  const code = rawCode.trim();
  if (!code) return undefined;

  const scores = emptyScores();

  addScore(scores, 'cpp', code, /#\s*include\s*[<"]/i, 12);
  addScore(scores, 'cpp', code, /\b(?:std::|cout\s*<<|cin\s*>>|using\s+namespace\s+std)\b/i, 9);
  addScore(scores, 'cpp', code, /\b(?:int|auto)\s+main\s*\(/i, 10);
  addScore(scores, 'cpp', code, /\b(?:vector|string|iostream|ostream|istream)\s*(?:<|::|\w)/i, 4);
  addScore(scores, 'cpp', code, /\b(?:int|double|float|bool|char|long|short|string|auto)\s+[A-Za-z_]\w*\s*(?:=|;|,)/, 5);

  addScore(scores, 'python', code, /\bdef\s+[A-Za-z_]\w*\s*\([^)]*\)\s*:/, 12);
  addScore(scores, 'python', code, /\b(?:from\s+[\w.]+\s+import|import\s+[\w.]+)/, 7);
  addScore(scores, 'python', code, /\bif\s+__name__\s*==\s*['"]__main__['"]\s*:/, 10);
  addScore(scores, 'python', code, /\b(?:print|range|len|enumerate)\s*\(/, 4);
  addScore(scores, 'python', code, /(?:^|\n)\s*(?:for|while|if|elif|else|class|try|except)\b[^\n]*:/, 5);

  addScore(scores, 'java', code, /\bpublic\s+static\s+void\s+main\s*\(/, 13);
  addScore(scores, 'java', code, /\bSystem\.(?:out|err)\.(?:print|println|printf)\s*\(/, 10);
  addScore(scores, 'java', code, /\b(?:package\s+[\w.]+|import\s+java\.[\w.*]+)\s*;/, 8);
  addScore(scores, 'java', code, /\b(?:public|private|protected)\s+(?:final\s+)?class\s+[A-Z]\w*/, 8);
  addScore(scores, 'java', code, /\bnew\s+[A-Z]\w*(?:<[^>]+>)?\s*\(/, 4);

  addScore(scores, 'javascript', code, /\bconsole\.(?:log|warn|error)\s*\(/, 9);
  addScore(scores, 'javascript', code, /(?:^|[;{}\n])\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/, 6);
  addScore(scores, 'javascript', code, /(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 10);
  addScore(scores, 'javascript', code, /\b(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/, 10);
  addScore(scores, 'javascript', code, /\b(?:document|window)\.[A-Za-z_$][\w$]*/, 6);
  addScore(scores, 'javascript', code, /\b(?:require\s*\(|module\.exports|export\s+(?:default|const|function|class))/, 7);

  addScore(scores, 'sql', code, /\bSELECT\b[\s\S]+\bFROM\b/i, 12);
  addScore(scores, 'sql', code, /\bINSERT\s+INTO\b[\s\S]+\bVALUES\b/i, 12);
  addScore(scores, 'sql', code, /\bUPDATE\b[\s\S]+\bSET\b/i, 11);
  addScore(scores, 'sql', code, /\b(?:DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, 11);
  addScore(scores, 'sql', code, /\b(?:WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/i, 3);

  addScore(scores, 'html', code, /<!doctype\s+html\b/i, 13);
  addScore(scores, 'html', code, /<(?:html|head|body|main|section|article|div|form|table)\b[^>]*>/i, 7);
  addScore(scores, 'html', code, /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*<\/\1\s*>/i, 8);
  addScore(scores, 'html', code, /<(?:input|img|br|hr|meta|link)\b[^>]*\/?>/i, 5);

  addScore(scores, 'css', code, /(?:^|[}\n])\s*[@.#]?[A-Za-z][^{}\n]*\{[^{}]*:[^{}]*\}/, 10);
  addScore(scores, 'css', code, /\b(?:color|display|position|margin|padding|font-size|background|grid-template|flex-direction)\s*:/i, 5);
  addScore(scores, 'css', code, /@(?:media|supports|keyframes|font-face)\b/i, 8);

  const ranked = LESSON_PLAN_CODE_LANGUAGES
    .map((language) => ({ language, score: scores[language] }))
    .sort((left, right) => right.score - left.score);

  return ranked[0].score >= 5 ? ranked[0].language : undefined;
}

function normalizeInlineCode(source: string): string {
  return source.replace(INLINE_CODE_PATTERN, (original, rawCode: string) => {
    const code = rawCode.trim();
    const language = inferLessonPlanCodeLanguage(code);
    if (!language || !shouldPromoteToCodeBlock(code, language)) return original;

    return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
  });
}

function shouldPromoteToCodeBlock(code: string, language: LessonPlanCodeLanguage): boolean {
  if (code.includes('```') || code.includes('~~~')) return false;

  const semicolonCount = (code.match(/;/g) || []).length;
  const hasBlock = /[{}]/.test(code);
  const hasMultipleLines = /\r|\n/.test(code);
  const isLongStructuredSnippet = code.length >= 40 && (semicolonCount >= 2 || hasBlock || hasMultipleLines);

  if (isLongStructuredSnippet) return true;

  switch (language) {
    case 'cpp':
      return /#\s*include|\b(?:int|auto)\s+main\s*\(|\busing\s+namespace\s+std\b/i.test(code);
    case 'python':
      return /\bdef\s+\w+\s*\([^)]*\)\s*:|\bif\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(code);
    case 'java':
      return /\bpublic\s+static\s+void\s+main\s*\(|\b(?:public|private|protected)\s+(?:final\s+)?class\b/.test(code);
    case 'javascript':
      return /\b(?:async\s+)?function\s+\w+\s*\(|(?:\([^)]*\)|\w+)\s*=>/.test(code);
    case 'sql':
      return /\b(?:SELECT\b[\s\S]+\bFROM|INSERT\s+INTO\b[\s\S]+\bVALUES|UPDATE\b[\s\S]+\bSET|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(code);
    case 'html':
      return /<!doctype\s+html\b|<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*<\/\1\s*>/i.test(code);
    case 'css':
      return /(?:^|[}\n])\s*[@.#]?[A-Za-z][^{}\n]*\{[^{}]*:[^{}]*\}/.test(code);
  }
}

function emptyScores(): LanguageScores {
  return {
    cpp: 0,
    python: 0,
    java: 0,
    javascript: 0,
    sql: 0,
    html: 0,
    css: 0,
  };
}

function addScore(
  scores: LanguageScores,
  language: LessonPlanCodeLanguage,
  code: string,
  pattern: RegExp,
  score: number,
) {
  if (pattern.test(code)) scores[language] += score;
}

function readOpeningFence(line: string): FenceMarker | undefined {
  const content = stripLineEnding(line);
  const match = content.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;

  return {
    character: match[1][0] as FenceMarker['character'],
    length: match[1].length,
  };
}

function isClosingFence(line: string, fence: FenceMarker): boolean {
  const content = stripLineEnding(line);
  const character = escapeRegExp(fence.character);
  return new RegExp(`^ {0,3}${character}{${fence.length},}\\s*$`).test(content);
}

function stripLineEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
