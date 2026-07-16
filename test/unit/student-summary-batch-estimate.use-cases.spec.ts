import { StudentSummaryBatchEstimateUseCases } from '../../src/modules/ai/student-summary-batch-estimate.use-cases';

describe('StudentSummaryBatchEstimateUseCases', () => {
  const user = { id: 'teacher-1' } as never;
  const config = { id: 'config-1', model: 'model-a', maxTokens: 1200 };

  it('checks every student and reports the conservative batch reservation', async () => {
    const fixture = dependencies(5000);

    const result = await fixture.service.estimate({
      studentIds: ['student-1', 'student-2'], maxTokens: 1000,
    }, user);

    expect(fixture.dataScope.assertStudentSummaryAccessible).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      taskCount: 2,
      requestedOutputTokensPerTask: 1000,
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

  function dependencies(remainingTokens: number | null) {
    const dataScope = { assertStudentSummaryAccessible: jest.fn().mockResolvedValue(undefined) };
    const metrics = { recordAiBudgetDecision: jest.fn() };
    const service = new StudentSummaryBatchEstimateUseCases(
      dataScope as never,
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      { quota: jest.fn().mockResolvedValue({ remainingTokens }) } as never,
      metrics as never,
    );
    return { service, dataScope, metrics };
  }
});
