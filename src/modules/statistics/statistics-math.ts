export function average(values: number[]) {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

export function scoreSummary(scores: number[]) {
  return {
    averageScore: average(scores),
    medianScore: median(scores),
    maxScore: scores.length ? Math.max(...scores) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
  };
}

export function ratio(numerator: number, denominator: number, digits = 4) {
  return denominator ? Number((numerator / denominator).toFixed(digits)) : 0;
}

export function diagnosticSuggestion(
  discrimination: number,
  difficultyDelta: number,
  anomalyCount: number,
) {
  const suggestions: string[] = [];
  if (discrimination < 0.15) suggestions.push('区分度偏低，建议复核题干、答案或评分规则');
  if (difficultyDelta > 1) suggestions.push('实际难度高于配置，可考虑调低分值或补充讲解');
  if (difficultyDelta < -1) suggestions.push('实际难度低于配置，可调整难度标签');
  if (anomalyCount > 0) suggestions.push('存在异常判分记录，建议抽查答卷');
  return suggestions.length ? suggestions.join('；') : '表现正常';
}
