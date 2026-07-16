import { MetricsService } from '../../src/observability/metrics.service';

describe('MetricsService', () => {
  it('renders counters and cumulative histograms in Prometheus format', () => {
    const metrics = new MetricsService();
    metrics.recordHttp('GET', '/api/v1/health', 200, 0.01);
    metrics.recordHttp('GET', '/api/v1/health', 200, 0.2);
    metrics.recordPrismaQuery(0.005);
    metrics.recordHydro('login', 'success', 0.2);
    metrics.recordExportQueue('success');
    metrics.setExportQueueDepth('pending', 2);
    metrics.recordExamOperation('submit', 'success');
    metrics.recordAiSummary({
      summaryType: 'exam',
      provider: 'test-provider',
      outcome: 'success',
      durationSeconds: 0.4,
      inputTokens: 120,
      outputTokens: 40,
      estimatedCost: 0.001,
      cacheHit: false,
    });
    metrics.recordAiBudgetDecision('teacher', 'accepted');
    metrics.recordAiSummary({
      summaryType: 'student', provider: 'test-provider', outcome: 'failed', durationSeconds: 0.1,
    });

    const output = metrics.renderPrometheus();
    expect(output).toContain('online_exam_http_requests_total{method="GET",route="/api/v1/health",status="200"} 2');
    expect(output).toContain('online_exam_http_request_duration_seconds_count{method="GET",route="/api/v1/health",status="200"} 2');
    expect(output).toContain('online_exam_prisma_query_duration_seconds_count 1');
    expect(output).toContain('online_exam_hydro_operation_duration_seconds_count{operation="login",outcome="success"} 1');
    expect(output).toContain('online_exam_export_queue_depth{status="pending"} 2');
    expect(output).toContain('online_exam_student_attempt_operations_total{operation="submit",outcome="success"} 1');
    expect(output).toContain('online_exam_ai_tokens_total{direction="input",outcome="success",provider="test-provider",summary_type="exam"} 120');
    expect(output).toContain('online_exam_ai_cache_lookups_total{outcome="miss",summary_type="exam"} 1');
    expect(output).toContain('online_exam_ai_budget_decisions_total{outcome="accepted",scope="teacher"} 1');
  });

  it('escapes untrusted label values', () => {
    const metrics = new MetricsService();
    metrics.recordHydro('login', 'bad"value\n');
    expect(metrics.renderPrometheus()).toContain('outcome="bad\\"value\\n"');
  });
});
