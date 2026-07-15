const { execFileSync } = require('node:child_process');

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error('npm_execpath is unavailable; run this check through pnpm.');
const output = execFileSync(process.execPath, [pnpmEntry, 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
});
const licenses = JSON.parse(output);
const allowed = new Set([
  '(MIT AND Zlib)',
  '(MIT OR GPL-3.0-or-later)',
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
  'MIT/X11',
  'Python-2.0',
  'Unlicense',
]);
const reviewedUnknown = new Set(['buffers@0.1.1']);
const failures = [];

for (const [license, packages] of Object.entries(licenses)) {
  if (allowed.has(license)) continue;
  for (const item of packages) {
    for (const version of item.versions ?? []) {
      const identifier = `${item.name}@${version}`;
      if (license === 'Unknown' && reviewedUnknown.has(identifier)) continue;
      failures.push(`${identifier}: ${license}`);
    }
  }
}

if (failures.length) {
  console.error(`Unapproved production dependency licenses:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Production dependency license policy passed.');
