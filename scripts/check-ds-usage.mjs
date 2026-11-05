// Design-system guardrail. Runs in CI on every PR. No dependencies.
// Feature code (src/app/**) must be built from @ds/ui and tokens only.
//
// Rules for src/app/** :
//   1. No raw colors in .scss/.ts/.html (hex, rgb(), hsl()) — use var(--ds-color-*)
//   2. No raw px values in .scss except 0/1px borders — use var(--ds-spacing-*) / var(--ds-radius-*)
//   3. No native <button> or <input> in templates — use <ds-button> / <ds-input>
//   4. Imports from the design system only through '@ds/ui' (no deep imports into src/ds)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/app');

const walk = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const rules = [
  { id: 'no-raw-color', files: /\.(scss|ts|html)$/, re: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, msg: 'Raw color. Use var(--ds-color-*).' },
  { id: 'no-raw-px', files: /\.scss$/, re: /(?<![\w-])(?!0px|1px)\d+(\.\d+)?px/, msg: 'Raw px value. Use var(--ds-spacing-*) or var(--ds-radius-*).' },
  { id: 'no-native-button', files: /\.(html|ts)$/, re: /<button[\s>]/, msg: 'Native <button>. Use <ds-button>.' },
  { id: 'no-native-input', files: /\.(html|ts)$/, re: /<input[\s>]/, msg: 'Native <input>. Use <ds-input>.' },
  { id: 'no-deep-ds-import', files: /\.ts$/, re: /from ['"](\.\.\/)+ds\/|from ['"]src\/ds\//, msg: "Deep import into the design system. Import from '@ds/ui'." },
];

const problems = [];
let scanned = 0;
for (const file of walk(target)) {
  if (file.endsWith('.mock.ts') || file.endsWith('.spec.ts')) continue;
  scanned++;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('ds-allow')) return; // explicit, reviewable escape hatch
    for (const r of rules) if (r.files.test(file) && r.re.test(line)) {
      problems.push(`${relative(root, file)}:${i + 1}  [${r.id}] ${r.msg}\n    ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(`check:ds — ${problems.length} problem(s) in ${scanned} file(s):\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check:ds — ${scanned} file(s) clean. Feature code uses only @ds/ui and tokens.`);
