export const DEFAULT_BLANK_ANSWER_TEXT = ['第1空：print', '第2空：range', '第3空：len'].join('\n');

export function emptyFillBlankRows(count = 1) {
  const total = Math.max(1, Number(count) || 1);
  return Array.from({ length: total }, () => ({ answerText: '' }));
}

export function buildFillBlankAnswer(value, totalScore, options = {}) {
  const { ignoreCase = true, trimSpace = true } = options;
  const blanks = parseFillBlankAnswerText(value, { trimSpace });
  if (!blanks.length) {
    throw new Error('填空题请至少填写一个空的答案');
  }

  const score = Number(totalScore) || 0;
  const blankScore = blanks.length ? score / blanks.length : score;
  return {
    blanks: blanks.map((blank) => ({
      index: blank.index,
      answers: blank.answers,
      ignoreCase,
      trimSpace,
      score: blankScore,
    })),
  };
}

export function fillBlankRowsFromText(value, minCount = 1) {
  const blanks = parseFillBlankAnswerText(value);
  if (!blanks.length) return emptyFillBlankRows(minCount);
  return blanks.map((blank) => ({
    answerText: blank.answers.join(', '),
  }));
}

export function fillBlankAnswerTextFromRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const answerText = String(row?.answerText ?? '').trim();
      return answerText ? `第${index + 1}空：${answerText}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function parseFillBlankAnswerText(value, options = {}) {
  const { trimSpace = true } = options;
  const segments = String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+|[;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return segments
    .map((segment, offset) => {
      const parsed = parseBlankSegment(segment, offset + 1);
      const answers = splitBlankAnswers(parsed.answerText, trimSpace);
      return answers.length ? { index: parsed.index, answers } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

export function fillBlankAnswerTextFromRules(blanks = []) {
  if (!Array.isArray(blanks) || !blanks.length) return '';
  return [...blanks]
    .sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0))
    .map((blank, offset) => {
      const index = Number(blank?.index) || offset + 1;
      const answers = Array.isArray(blank?.answers) ? blank.answers.map(String).filter(Boolean) : [];
      return answers.length ? `第${index}空：${answers.join(', ')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseBlankSegment(segment, fallbackIndex) {
  const text = String(segment || '').trim();
  const match = text.match(/^(?:第\s*)?(?:空\s*)?(\d+)\s*(?:空)?\s*[:：.、=]\s*(.+)$/i);
  if (match) {
    return {
      index: Number(match[1]) || fallbackIndex,
      answerText: match[2],
    };
  }
  return { index: fallbackIndex, answerText: text };
}

function splitBlankAnswers(value, trimSpace) {
  return String(value || '')
    .split(/[,，|、]/)
    .map((item) => (trimSpace ? item.trim() : item))
    .filter((item) => item.length);
}
