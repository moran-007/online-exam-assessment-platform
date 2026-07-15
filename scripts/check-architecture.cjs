const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const failures = [];

function filesUnder(directory, extensions) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => name.endsWith(extension))) result.push(path);
  }
  return result;
}

for (const oldService of [
  'src/modules/questions/questions.service.ts',
  'src/modules/student/student.service.ts',
  'src/modules/exams/exams.service.ts',
  'src/modules/hydro/hydro.service.ts',
  'src/modules/exports/exports.service.ts',
]) {
  if (existsSync(join(root, oldService))) failures.push(`legacy service still exists: ${oldService}`);
}

for (const domain of ['questions', 'exams', 'hydro', 'exports']) {
  for (const layer of ['api', 'components', 'composables', 'models']) {
    const path = join(root, 'frontend/src/features', domain, layer);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      failures.push(`feature layer missing: frontend/src/features/${domain}/${layer}`);
    }
  }
}

for (const file of filesUnder(join(root, 'src/modules'), ['.operations.ts', '.use-cases.ts'])) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lines > 550) failures.push(`use-case file exceeds 550 lines: ${relative(root, file)} (${lines})`);
}

const frontendFiles = filesUnder(join(root, 'frontend/src'), ['.vue', '.js', '.ts'])
  .filter((file) => !file.includes(`${join('api', 'generated')}`));
for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  const path = relative(root, file);
  if (/\bapi\s*\(/.test(source)) failures.push(`legacy api() call: ${path}`);
  if (/\bfetch\s*\(/.test(source) && path !== join('frontend', 'src', 'api.js')) {
    failures.push(`direct fetch outside session adapter: ${path}`);
  }
}

const routeSource = readFileSync(join(root, 'frontend/src/router.js'), 'utf8');
if (/import\s+\w+View\s+from\s+['"]\.\/views\//.test(routeSource)) {
  failures.push('router contains a statically imported view');
}
for (const name of [...routeSource.matchAll(/component:\s*(\w+View)\b/g)].map((match) => match[1])) {
  if (!new RegExp(`const\\s+${name}\\s*=\\s*\\(\\)\\s*=>\\s*import\\(`).test(routeSource)) {
    failures.push(`route component is not backed by a dynamic import: ${name}`);
  }
}

for (const routeView of [
  'QuestionImportView.vue',
  'QuestionView.vue',
  'ExamTakingView.vue',
  'ExamView.vue',
  'StatisticsView.vue',
  'ExportView.vue',
  'ExternalAccountView.vue',
]) {
  const path = join(root, 'frontend/src/views', routeView);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
  if (lines > 100) failures.push(`P1 route view is not an orchestration shell: ${routeView} (${lines})`);
}

for (const domain of ['questions', 'exams', 'hydro', 'exports']) {
  const componentDirectory = join(root, 'frontend/src/features', domain, 'components');
  for (const file of filesUnder(componentDirectory, ['.vue'])) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
    if (lines > 500) {
      failures.push(`P1 feature component exceeds 500 lines: ${relative(root, file)} (${lines})`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Architecture guard passed.');
