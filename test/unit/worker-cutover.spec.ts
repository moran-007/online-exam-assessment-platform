import { evaluateEntityDifference } from '../../scripts/cutover/worker-reconciliation';

describe('worker cutover reconciliation', () => {
  it('passes exact source-to-target mappings', () => {
    expect(evaluateEntityDifference(0, 0, 0)).toEqual({
      disposition: 'MATCHED',
      passed: true,
    });
  });

  it('accepts only differences covered by signed migration conflicts', () => {
    expect(evaluateEntityDifference(-2, 0, 2)).toEqual({
      disposition: 'SIGNED_CONFLICT',
      passed: true,
    });
    expect(evaluateEntityDifference(-3, 0, 2)).toEqual({
      disposition: 'UNRESOLVED',
      passed: false,
    });
  });

  it('never signs away missing target rows', () => {
    expect(evaluateEntityDifference(-1, 1, 1)).toEqual({
      disposition: 'SIGNED_CONFLICT',
      passed: false,
    });
  });
});
