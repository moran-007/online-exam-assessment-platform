import {
  average,
  diagnosticSuggestion,
  ratio,
  scoreSummary,
  median,
} from '../../src/modules/statistics/statistics-math';

describe('statistics math', () => {
  it('uses stable rounding and zero-safe score summaries', () => {
    expect(average([])).toBe(0);
    expect(average([1, 2, 2])).toBe(1.67);
    expect(median([9, 1, 5, 7])).toBe(6);
    expect(scoreSummary([])).toEqual({ averageScore: 0, medianScore: 0, maxScore: 0, minScore: 0 });
    expect(scoreSummary([5, 7, 9])).toEqual({ averageScore: 7, medianScore: 7, maxScore: 9, minScore: 5 });
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(1, 0)).toBe(0);
  });

  it('builds deterministic diagnostic guidance from calculated facts', () => {
    expect(diagnosticSuggestion(0.4, 0, 0)).toBe('表现正常');
    expect(diagnosticSuggestion(0.1, 1.5, 2)).toBe(
      '区分度偏低，建议复核题干、答案或评分规则；实际难度高于配置，可考虑调低分值或补充讲解；存在异常判分记录，建议抽查答卷',
    );
  });
});
