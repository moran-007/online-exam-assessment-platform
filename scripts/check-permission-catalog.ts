import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { permissions } from '../prisma/seed';

const sourceRoot = join(process.cwd(), 'src');
const registered = new Set(permissions.map(([code]) => code));
const referenced = new Set<string>();

async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      continue;
    }
    if (extname(entry.name) !== '.ts') continue;

    const source = await readFile(path, 'utf8');
    for (const decorator of source.matchAll(/@Permissions\s*\(([\s\S]*?)\)/g)) {
      for (const literal of decorator[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
        referenced.add(literal[1]);
      }
    }
  }
}

async function main() {
  await inspect(sourceRoot);
  const missing = [...referenced].filter((code) => !registered.has(code)).sort();
  if (missing.length) {
    console.error('以下功能权限未加入 prisma/seed.ts 权限目录：');
    for (const code of missing) console.error(`- ${code}`);
    process.exitCode = 1;
  } else {
    console.log(`权限目录检查通过：控制器引用 ${referenced.size} 项，目录登记 ${registered.size} 项。`);
  }
}

void main();
