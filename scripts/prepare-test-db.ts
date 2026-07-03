import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

loadEnv();
const testUrl = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/online_exam_test?schema=public';
const parsed = new URL(testUrl);
const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (!databaseName.endsWith('_test')) throw new Error(`Refusing to prepare non-test database: ${databaseName}`);

const env = {
  ...process.env,
  DATABASE_URL: testUrl,
  PGHOST: parsed.hostname,
  PGPORT: parsed.port || '5432',
  PGUSER: decodeURIComponent(parsed.username),
  PGPASSWORD: decodeURIComponent(parsed.password),
  PGDATABASE: 'postgres',
};

try {
  execFileSync(postgresBinary('createdb'), [databaseName], { stdio: 'pipe', env });
} catch (error: any) {
  const message = String(error?.stderr || error?.message || error);
  if (!/already exists|已.*存在/i.test(message)) throw error;
}
execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env,
});

function postgresBinary(name: string) {
  const extension = process.platform === 'win32' ? '.exe' : '';
  if (process.env.POSTGRES_BIN_DIR) return join(process.env.POSTGRES_BIN_DIR, `${name}${extension}`);
  if (process.platform === 'win32') return join('D:\\PostgreSQL\\pgsql\\bin', `${name}.exe`);
  return name;
}

function loadEnv() {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
