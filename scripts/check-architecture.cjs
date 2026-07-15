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
  'src/modules/papers/papers.service.ts',
  'src/modules/users/users.service.ts',
  'src/modules/grading/grading.service.ts',
]) {
  if (existsSync(join(root, oldService))) failures.push(`legacy service still exists: ${oldService}`);
}

for (const domain of ['questions', 'exams', 'hydro', 'exports', 'papers', 'ai']) {
  for (const layer of ['api', 'components', 'composables', 'models']) {
    const path = join(root, 'frontend/src/features', domain, layer);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      failures.push(`feature layer missing: frontend/src/features/${domain}/${layer}`);
    }
  }
}

for (const file of filesUnder(join(root, 'src/modules'), ['.operations.ts', '.use-case.ts', '.use-cases.ts'])) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lines > 550) failures.push(`use-case file exceeds 550 lines: ${relative(root, file)} (${lines})`);
}

const frontendFiles = filesUnder(join(root, 'frontend/src'), ['.vue', '.js', '.ts'])
  .filter((file) => !file.includes(`${join('api', 'generated')}`))
  .filter((file) => !file.endsWith('.d.ts'));
let explicitAnyCount = 0;
for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  const path = relative(root, file);
  if (/@ts-nocheck\b/.test(source)) failures.push(`business TypeScript bypass: ${path}`);
  const explicitAnyMatches = source.match(/:\s*any\b|\bas\s+any\b|\bany\[\]|<[^>\r\n]*\bany\b/g) ?? [];
  explicitAnyCount += explicitAnyMatches.length;
  if (file.endsWith('.vue') && /from\s+['"][^'"]*\/api\/generated\//.test(source)) {
    failures.push(`view imports generated API directly: ${path}`);
  }
  if (/\bapi\s*\(/.test(source)) failures.push(`legacy api() call: ${path}`);
  if (/\bfetch\s*\(/.test(source) && path !== join('frontend', 'src', 'api.js')) {
    failures.push(`direct fetch outside session adapter: ${path}`);
  }
}

const explicitAnyBudget = 3;
if (explicitAnyCount > explicitAnyBudget) {
  failures.push(`frontend explicit any budget exceeded: ${explicitAnyCount} > ${explicitAnyBudget}`);
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
  'PaperView.vue',
  'AiSettingsView.vue',
]) {
  const path = join(root, 'frontend/src/views', routeView);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
  if (lines > 100) failures.push(`P1 route view is not an orchestration shell: ${routeView} (${lines})`);
}

for (const domain of ['questions', 'exams', 'hydro', 'exports', 'papers', 'ai']) {
  const componentDirectory = join(root, 'frontend/src/features', domain, 'components');
  for (const file of filesUnder(componentDirectory, ['.vue'])) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
    if (lines > 500) {
      failures.push(`P1 feature component exceeds 500 lines: ${relative(root, file)} (${lines})`);
    }
  }
}

for (const coordinator of [
  'frontend/src/features/questions/composables/useQuestionPage.ts',
  'frontend/src/features/questions/composables/useQuestionImportPage.ts',
  'frontend/src/features/exams/composables/useExamTakingPage.ts',
  'frontend/src/features/exams/composables/useExamManagementPage.ts',
  'frontend/src/features/exams/composables/useStatisticsPage.ts',
  'frontend/src/features/exports/composables/useExportPage.ts',
  'frontend/src/features/hydro/composables/useExternalAccountPage.ts',
]) {
  const path = join(root, coordinator);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
  if (lines > 500) failures.push(`P1 page coordinator exceeds 500 lines: ${coordinator} (${lines})`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Architecture guard passed.');
