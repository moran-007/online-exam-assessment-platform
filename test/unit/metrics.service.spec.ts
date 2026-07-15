import { MetricsService } from '../../src/observability/metrics.service';

describe('MetricsService', () => {
  it('renders counters and cumulative histograms in Prometheus format', () => {
    const metrics = new MetricsService();
    metrics.recordHttp('GET', '/api/v1/health', 200, 0.01);
    metrics.recordHttp('GET', '/api/v1/health', 200, 0.2);
    metrics.recordPrismaQuery(0.005);

    const output = metrics.renderPrometheus();
    expect(output).toContain('online_exam_http_requests_total{method="GET",route="/api/v1/health",status="200"} 2');
    expect(output).toContain('online_exam_http_request_duration_seconds_count{method="GET",route="/api/v1/health",status="200"} 2');
    expect(output).toContain('online_exam_prisma_query_duration_seconds_count 1');
  });

  it('escapes untrusted label values', () => {
    const metrics = new MetricsService();
    metrics.recordHydro('login', 'bad"value\n');
    expect(metrics.renderPrometheus()).toContain('outcome="bad\\"value\\n"');
  });
});
