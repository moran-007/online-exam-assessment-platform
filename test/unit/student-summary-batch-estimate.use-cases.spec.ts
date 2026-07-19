import { StudentSummaryBatchEstimateUseCases } from '../../src/modules/ai/student-summary-batch-estimate.use-cases';

describe('StudentSummaryBatchEstimateUseCases', () => {
  const user = { id: 'teacher-1' } as never;
  const config: { id: string; provider: string; model: string; maxTokens: number | null } = {
    id: 'config-1', provider: 'custom', model: 'model-a', maxTokens: 1200,
  };

  it('checks every student and reports the conservative batch reservation', async () => {
    const fixture = dependencies(5000);

    const result = await fixture.service.estimate({
      studentIds: ['student-1', 'student-2'], maxTokens: 1000,
    }, user);

    expect(fixture.dataScope.assertStudentSummaryAccessible).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      taskCount: 2,
      requestedOutputTokensPerTask: 1000,
      reservationOutputTokensPerTask: 1000,
      estimatedReservedTokens: 2000,
      remainingTokens: 5000,
      withinLocalBudget: true,
      confirmationRequired: true,
      maxBatchSize: 20,
    });
  });

  it('uses the configuration ceiling when maxTokens is absent and flags insufficient budget', async () => {
    const fixture = dependencies(2000);

    const result = await fixture.service.estimate({
      studentIds: ['student-1', 'student-2'],
    }, user);

    expect(result).toMatchObject({
      requestedOutputTokensPerTask: 1200,
      estimatedReservedTokens: 2400,
      withinLocalBudget: false,
    });
    expect(fixture.metrics.recordAiBudgetDecision).toHaveBeenCalledWith(
      'student-summary-batch-estimate',
      'rejected',
    );
  });

  it('reports provider-default requests separately from the reservation estimate', async () => {
    const fixture = dependencies(20_000, { ...config, maxTokens: null });

    const result = await fixture.service.estimate({ studentIds: ['student-1'] }, user);

    expect(result).toMatchObject({
      requestedOutputTokensPerTask: null,
      reservationOutputTokensPerTask: 8192,
      estimatedReservedTokens: 8192,
    });
  });

  function dependencies(remainingTokens: number | null, resolvedConfig = config) {
    const dataScope = { assertStudentSummaryAccessible: jest.fn().mockResolvedValue(undefined) };
    const metrics = { recordAiBudgetDecision: jest.fn() };
    const service = new StudentSummaryBatchEstimateUseCases(
      dataScope as never,
      { resolve: jest.fn().mockResolvedValue(resolvedConfig) } as never,
      { resolve: jest.fn().mockResolvedValue({ maxOutputTokens: null }) } as never,
      { quota: jest.fn().mockResolvedValue({ remainingTokens }) } as never,
      metrics as never,
    );
    return { service, dataScope, metrics };
  }
});
