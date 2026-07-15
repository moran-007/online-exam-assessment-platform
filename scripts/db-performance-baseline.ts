import { PrismaClient } from '@prisma/client';

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
  };

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
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database baseline failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
