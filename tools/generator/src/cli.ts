// Node CLI: generate the Angular files for a snapshot, like the plugin does.
//   node tools/generator/dist/cli.js <snapshot.json> [--out <dir>] [--check]
// Reads figma/mapping.json, .ship-to-frontend.json and the current routes/main files from
// the repo root (the current directory). --out writes the files under <dir>; without it
// the files are written in place. --check prints the readiness report and exits 1 if blocked.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generate } from './generate';
import type { Mapping, ShipConfig, Snapshot } from './types';

const args = process.argv.slice(2);
const snapshotPath = args.find(a => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : '.';
const checkOnly = args.includes('--check');
if (!snapshotPath) {
  console.error('usage: cli.js <snapshot.json> [--out <dir>] [--check]');
  process.exit(2);
}

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
const mapping = JSON.parse(read('figma/mapping.json')) as Mapping;
const config = JSON.parse(read('.ship-to-frontend.json')) as ShipConfig;
const existing: Record<string, string> = {};
for (const p of [config.paths.routes, config.paths.main]) if (existsSync(join(root, p))) existing[p] = read(p);

const result = generate(snapshot, { mapping, config, existing });

for (const i of result.issues) console.log(`${i.severity === 'block' ? 'BLOCK' : 'warn '}  [${i.rule}] ${i.message}  (${i.nodeId})`);
console.log(`\n${result.featureTitle}: ${result.states.join(', ')} → ${result.designBranch} → ${result.projectBranch}`);
if (checkOnly) process.exit(result.blocked ? 1 : 0);

for (const f of result.files) {
  const p = join(out, f.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.content);
  console.log(`${f.mode === 'edit' ? 'edited ' : 'created'}  ${f.path}`);
}
mkdirSync(join(out, '.ship-to-frontend'), { recursive: true });
writeFileSync(join(out, '.ship-to-frontend', `PR_BODY_${result.feature}.md`), result.prBody);
if (result.blocked) console.log('\nBlocked: fix the BLOCK items in Figma before shipping.');
