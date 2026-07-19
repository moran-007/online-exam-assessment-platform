import { PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';

const prisma = new PrismaClient();

async function main() {
  const generatedAt = new Date().toISOString();
  const activity = await prisma.$queryRaw<Array<{
    state: string | null;
    wait_event_type: string | null;
    wait_event: string | null;
    count: bigint;
    oldest_seconds: number | null;
  }>>`
    SELECT state,
           wait_event_type,
           wait_event,
           COUNT(*)::bigint AS count,
           MAX(EXTRACT(EPOCH FROM (now() - xact_start)))::float8 AS oldest_seconds
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
    GROUP BY state, wait_event_type, wait_event
    ORDER BY count DESC
  `;
  const hasStatements = await prisma.$queryRaw<Array<{ installed: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS installed
  `;
  const slowQueries = hasStatements[0]?.installed
    ? await prisma.$queryRaw<Array<{
        query_id: bigint;
        calls: bigint;
        mean_ms: number;
        total_ms: number;
        rows: bigint;
      }>>`
        SELECT queryid AS query_id,
               calls::bigint,
               mean_exec_time::float8 AS mean_ms,
               total_exec_time::float8 AS total_ms,
               rows::bigint
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY total_exec_time DESC
        LIMIT 20
      `
    : [];
  const plans = {
    publishedQuestions: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, title, type, status, created_at
      FROM questions
      WHERE deleted_at IS NULL AND status = 'published'
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `,
    studentAttempts: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, exam_id, user_id, status, updated_at
      FROM exam_attempts
      ORDER BY updated_at DESC, id DESC
      LIMIT 20
    `,
    pendingExports: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, status, created_at
      FROM export_tasks
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT 50
    `,
    upcomingLessons: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, class_id, teacher_id, status, starts_at, ends_at
      FROM lesson_sessions
      WHERE status::text IN ('PLANNED', 'COMPLETED')
        AND starts_at >= now() - interval '30 days'
      ORDER BY starts_at ASC, id ASC
      LIMIT 100
    `,
    recentAttendance: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, session_id, student_id, status, deduct_hours, confirmed_at
      FROM attendance_records
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
    `,
    studentLessonHours: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, student_id, class_id, session_id, type, amount, created_at
      FROM lesson_hour_ledger
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
    recentAiSummaryTasks: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, type, subject_id, provider_config_id, status, created_at
      FROM ai_summary_tasks
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
    recentAiUsage: await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT provider_config_id, operation, usage_reported, total_tokens, reservation_output_tokens, created_at
      FROM ai_usage_events
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
  };
  const benchmarkIterations = iterationCount(process.env.PERF_ITERATIONS);
  const latencyBenchmarks = await runLatencyBenchmarks(benchmarkIterations);

  console.log(JSON.stringify({
    generatedAt,
    pgStatStatementsInstalled: Boolean(hasStatements[0]?.installed),
    activity: activity.map((row) => ({ ...row, count: Number(row.count) })),
    slowQueries: slowQueries.map((row) => ({
      ...row,
      query_id: String(row.query_id),
      calls: Number(row.calls),
      rows: Number(row.rows),
    })),
    plans,
    latencyBenchmarks,
  }, null, 2));
}

async function runLatencyBenchmarks(iterations: number) {
  const queries = {
    upcomingLessons: `SELECT id, class_id, status, starts_at FROM lesson_sessions
      WHERE starts_at >= now() - interval '30 days' ORDER BY starts_at ASC, id ASC LIMIT 100`,
    recentAttendance: `SELECT id, session_id, student_id, status FROM attendance_records
      ORDER BY updated_at DESC, id DESC LIMIT 100`,
    studentLessonHours: `SELECT id, student_id, class_id, type, amount FROM lesson_hour_ledger
      ORDER BY created_at DESC, id DESC LIMIT 100`,
    recentAiSummaryTasks: `SELECT id, type, subject_id, status FROM ai_summary_tasks
      ORDER BY created_at DESC, id DESC LIMIT 100`,
    recentAiUsage: `SELECT provider_config_id, operation, usage_reported, total_tokens FROM ai_usage_events
      ORDER BY created_at DESC, id DESC LIMIT 100`,
  };
  const results: Record<string, ReturnType<typeof latencySummary>> = {};
  for (const [name, sql] of Object.entries(queries)) {
    for (let index = 0; index < 3; index += 1) await prisma.$queryRawUnsafe(sql);
    const durations: number[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const startedAt = performance.now();
      await prisma.$queryRawUnsafe(sql);
      durations.push(performance.now() - startedAt);
    }
    results[name] = latencySummary(durations);
  }
  return {
    sampleSource: '当前数据库；发布前应在固定测试种子与生产只读副本分别执行',
    iterations,
    results,
  };
}

function latencySummary(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return {
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

function iterationCount(value: string | undefined) {
  const parsed = Number(value ?? 30);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 100 ? parsed : 30;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database baseline failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
