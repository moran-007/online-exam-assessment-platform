const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');

const distRoot = join(process.cwd(), 'frontend', 'dist');
const manifest = JSON.parse(readFileSync(join(distRoot, '.vite', 'manifest.json'), 'utf8'));
const entry = manifest['index.html'];

if (!entry?.isEntry) throw new Error('Vite entry is missing from the bundle manifest.');

const initialFiles = new Set();
collectImports('index.html', initialFiles);
const initialGzipBytes = [...initialFiles]
  .filter((file) => file.endsWith('.js'))
  .reduce((total, file) => total + gzipSync(readFileSync(join(distRoot, file))).length, 0);

const initialBudget = 550 * 1024;
if (initialGzipBytes > initialBudget) {
  throw new Error(`Initial JS gzip ${formatKb(initialGzipBytes)} exceeds ${formatKb(initialBudget)}.`);
}

const oversizedApplicationChunks = Object.values(manifest)
  .filter((item) => item.file?.endsWith('.js') && !/[/\\](vendor-|codemirror-language-)/.test(item.file))
  .map((item) => ({ file: item.file, bytes: statSync(join(distRoot, item.file)).size }))
  .filter((item) => item.bytes > 500 * 1024);

if (oversizedApplicationChunks.length) {
  throw new Error(`Application chunks exceed 500 KB: ${JSON.stringify(oversizedApplicationChunks)}`);
}

for (const expected of ['vendor-echarts', 'vendor-codemirror', 'vendor-katex', 'vendor-element-plus']) {
  if (!Object.values(manifest).some((item) => item.file?.includes(expected))) {
    throw new Error(`Required isolated chunk is missing: ${expected}`);
  }
}

process.stdout.write(`Bundle budget passed. Initial JS gzip: ${formatKb(initialGzipBytes)}.\n`);

function collectImports(key, files) {
  const item = manifest[key];
  if (!item || files.has(item.file)) return;
  files.add(item.file);
  for (const dependency of item.imports || []) collectImports(dependency, files);
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
