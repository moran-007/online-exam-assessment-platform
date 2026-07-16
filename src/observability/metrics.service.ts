import { Injectable } from '@nestjs/common';

type MetricLabels = Record<string, string>;

type MetricSample = {
  labels: MetricLabels;
  value: number;
};

type HistogramSample = MetricSample & {
  buckets: number[];
  count: number;
};

export type AiSummaryMetric = {
  summaryType: string;
  provider: string;
  outcome: string;
  durationSeconds: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  cacheHit?: boolean;
};

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DATABASE_BUCKETS = [0.001, 0.003, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, Map<string, MetricSample>>();
  private readonly gauges = new Map<string, Map<string, MetricSample>>();
  private readonly histograms = new Map<string, Map<string, HistogramSample>>();

  recordHttp(method: string, route: string, statusCode: number, durationSeconds: number) {
    const labels = { method, route, status: String(statusCode) };
    this.increment('online_exam_http_requests_total', labels);
    this.observe('online_exam_http_request_duration_seconds', labels, durationSeconds, HTTP_BUCKETS);
  }

  recordPrismaQuery(durationSeconds: number) {
    this.increment('online_exam_prisma_queries_total');
    this.observe('online_exam_prisma_query_duration_seconds', {}, durationSeconds, DATABASE_BUCKETS);
  }

  recordHydro(operation: string, outcome: string, durationSeconds?: number) {
    const labels = { operation, outcome };
    this.increment('online_exam_hydro_operations_total', labels);
    if (durationSeconds !== undefined) {
      this.observe('online_exam_hydro_operation_duration_seconds', labels, durationSeconds, HTTP_BUCKETS);
    }
  }

  recordExportQueue(outcome: string) {
    this.increment('online_exam_export_jobs_total', { outcome });
  }

  setExportQueueDepth(status: string, value: number) {
    this.setGauge('online_exam_export_queue_depth', { status }, value);
  }

  recordExamOperation(operation: 'autosave' | 'submit' | 'forced_finalize' | 'conflict', outcome: string) {
    this.increment('online_exam_student_attempt_operations_total', { operation, outcome });
  }

  recordAiSummary(metric: AiSummaryMetric) {
    const labels = {
      summary_type: metric.summaryType,
      provider: metric.provider,
      outcome: metric.outcome,
    };
    this.increment('online_exam_ai_summary_tasks_total', labels);
    this.observe('online_exam_ai_summary_duration_seconds', labels, metric.durationSeconds, HTTP_BUCKETS);
    if (metric.inputTokens) {
      this.increment('online_exam_ai_tokens_total', { ...labels, direction: 'input' }, metric.inputTokens);
    }
    if (metric.outputTokens) {
      this.increment('online_exam_ai_tokens_total', { ...labels, direction: 'output' }, metric.outputTokens);
    }
    if (metric.estimatedCost) {
      this.increment('online_exam_ai_estimated_cost_total', labels, metric.estimatedCost);
    }
    if (metric.cacheHit !== undefined) {
      this.increment('online_exam_ai_cache_lookups_total', {
        summary_type: metric.summaryType,
        outcome: metric.cacheHit ? 'hit' : 'miss',
      });
    }
  }

  recordAiBudgetDecision(scope: string, outcome: 'accepted' | 'rejected') {
    this.increment('online_exam_ai_budget_decisions_total', { scope, outcome });
  }

  renderPrometheus() {
    const lines: string[] = [];
    this.renderSimpleFamilies(lines, this.counters, 'counter');
    this.renderSimpleFamilies(lines, this.gauges, 'gauge');
    this.renderHistograms(lines);
    return `${lines.join('\n')}\n`;
  }

  private increment(name: string, labels: MetricLabels = {}, value = 1) {
    const family = this.family(this.counters, name);
    const key = this.labelKey(labels);
    const current = family.get(key) ?? { labels, value: 0 };
    current.value += value;
    family.set(key, current);
  }

  private setGauge(name: string, labels: MetricLabels, value: number) {
    this.family(this.gauges, name).set(this.labelKey(labels), { labels, value });
  }

  private observe(name: string, labels: MetricLabels, value: number, boundaries: number[]) {
    const family = this.family(this.histograms, name);
    const key = this.labelKey(labels);
    const current = family.get(key) ?? { labels, value: 0, count: 0, buckets: boundaries.map(() => 0) };
    current.value += value;
    current.count += 1;
    boundaries.forEach((boundary, index) => {
      if (value <= boundary) current.buckets[index] += 1;
    });
    family.set(key, current);
  }

  private family<T extends MetricSample>(registry: Map<string, Map<string, T>>, name: string) {
    const existing = registry.get(name);
    if (existing) return existing;
    const created = new Map<string, T>();
    registry.set(name, created);
    return created;
  }

  private renderSimpleFamilies(
    lines: string[],
    registry: Map<string, Map<string, MetricSample>>,
    type: 'counter' | 'gauge',
  ) {
    for (const [name, samples] of registry) {
      lines.push(`# TYPE ${name} ${type}`);
      for (const sample of samples.values()) {
        lines.push(`${name}${this.formatLabels(sample.labels)} ${sample.value}`);
      }
    }
  }

  private renderHistograms(lines: string[]) {
    for (const [name, samples] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      const boundaries = name.includes('prisma') ? DATABASE_BUCKETS : HTTP_BUCKETS;
      for (const sample of samples.values()) {
        const labels = sample.labels;
        boundaries.forEach((boundary, index) => {
          lines.push(`${name}_bucket${this.formatLabels({ ...labels, le: String(boundary) })} ${sample.buckets[index]}`);
        });
        lines.push(`${name}_bucket${this.formatLabels({ ...labels, le: '+Inf' })} ${sample.count}`);
        lines.push(`${name}_sum${this.formatLabels(labels)} ${sample.value}`);
        lines.push(`${name}_count${this.formatLabels(labels)} ${sample.count}`);
      }
    }
  }

  private labelKey(labels: MetricLabels) {
    return JSON.stringify(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
  }

  private formatLabels(labels: MetricLabels) {
    const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) return '';
    return `{${entries.map(([key, value]) => `${key}="${this.escapeLabel(value)}"`).join(',')}}`;
  }

  private escapeLabel(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }
}
