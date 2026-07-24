export function parseStructuredAiOutput(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回可识别的结构化内容，请重试');
  const result = JSON.parse(cleaned.slice(start, end + 1));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('AI 返回格式不正确，请重试');
  return result as Record<string, unknown>;
}

export function pickStructuredText(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, typeof source[key] === 'string' ? source[key].trim() : '']));
}
