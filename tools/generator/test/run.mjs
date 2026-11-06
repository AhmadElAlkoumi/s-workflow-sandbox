// Generator tests. Run with: npm run generator:test   (add --update to refresh the golden files)
//
//  1. Golden: the real Figma snapshot of "Team members / default" (node 4:11) produces
//     exactly test/expected/. Any change to generated code shows up as a diff here.
//  2. PR #1: compares the output with the hand-made reference PR #1 and reports how much
//     generated code is kept unchanged (target 85%+). Fails below the regression floor.
//  3. What-if: the same with three fixes a designer can make in Figma.
//  4. Guardrail: generated files pass scripts/check-ds-usage.mjs.
//  5. Re-ship: generating again on top of the output changes nothing.
//  6. States: a synthetic empty + error frame produce a state union, @switch and mocks.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare } from './compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const require = createRequire(import.meta.url);
const { generate } = require('../dist/index.js');
const update = process.argv.includes('--update');

const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const mapping = json('figma/mapping.json');
const config = json('.ship-to-frontend.json');
const snapshot = JSON.parse(readFileSync(join(here, 'fixtures/team-members.snapshot.json'), 'utf8'));
// Repo files the generator edits, as they are on main.
const baseExisting = {
  [config.paths.routes]: readFileSync(join(here, 'fixtures/main/app.routes.ts'), 'utf8'),
  [config.paths.main]: readFileSync(join(here, 'fixtures/main/main.ts'), 'utf8'),
};

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};
const pct = x => `${Math.round(x * 100)}%`;

const result = generate(snapshot, { mapping, config, existing: baseExisting });

// 1. Golden
const expectedDir = join(here, 'expected');
const files = (dir) => existsSync(dir) ? walk(dir).map(p => relative(dir, p)) : [];
function walk(dir) { return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
if (update) {
  rmSync(expectedDir, { recursive: true, force: true });
  for (const f of result.files) { mkdirSync(dirname(join(expectedDir, f.path)), { recursive: true }); writeFileSync(join(expectedDir, f.path), f.content); }
  writeFileSync(join(expectedDir, 'PR_BODY.md'), result.prBody);
  writeFileSync(join(expectedDir, 'issues.json'), JSON.stringify(result.issues, null, 2) + '\n');
  console.log('Updated test/expected/.');
}
const want = new Set(files(expectedDir).filter(f => f !== 'PR_BODY.md' && f !== 'issues.json'));
const got = new Set(result.files.map(f => f.path));
ok('golden: same file set', [...want].every(f => got.has(f)) && [...got].every(f => want.has(f)), [...got].filter(f => !want.has(f)).join(', '));
for (const f of result.files) {
  const p = join(expectedDir, f.path);
  ok(`golden: ${f.path}`, existsSync(p) && readFileSync(p, 'utf8') === f.content);
}
ok('golden: PR body', readFileSync(join(expectedDir, 'PR_BODY.md'), 'utf8') === result.prBody);
ok('golden: readiness issues', readFileSync(join(expectedDir, 'issues.json'), 'utf8') === JSON.stringify(result.issues, null, 2) + '\n');
ok('readiness: not blocked', !result.blocked, result.issues.filter(i => i.severity === 'block').map(i => i.message).join('; '));

// 2. PR #1
const ref = join(here, 'reference/pr-1');
const pr1 = compare(result.files, ref);
console.log('\nGenerated vs PR #1 (non-blank, non-comment lines):');
console.table(pr1.rows);
console.log(`kept unchanged: ${pr1.total.kept}/${pr1.total.generated} = ${pct(pr1.total.keptPct)}   coverage of PR #1: ${pct(pr1.total.coveragePct)}\n`);
ok('PR #1: kept-unchanged above regression floor (70%)', pr1.total.keptPct >= 0.7, pct(pr1.total.keptPct));

// 3. What-if: three Figma-side changes (no generator change).
const fixed = structuredClone(snapshot);
const each = (n, fn) => { fn(n); (n.children ?? []).forEach(c => each(c, fn)); };
const all = [...fixed.frames, ...Object.values(fixed.components)];
all.forEach(r => each(r, n => {
  if (n.id === '4:7' || n.id.endsWith(';4:7')) n.name = 'status'; // name the varying Badge layer
  if (n.id === '4:12' || n.id === '4:28') n.layout.wrap = true; // header + invite form wrap
  if (n.id === '4:6' || n.id.endsWith(';4:6')) n.text.truncate = true; // email truncates
}));
const whatIf = compare(generate(fixed, { mapping, config, existing: baseExisting }).files, ref);
console.log(`What-if (rename Badge → "status", wrap header and invite form, truncate email): kept ${pct(whatIf.total.keptPct)}, coverage ${pct(whatIf.total.coveragePct)}\n`);
ok('what-if: Figma fixes raise kept-unchanged', whatIf.total.keptPct > pr1.total.keptPct, pct(whatIf.total.keptPct));

// 4. Guardrail
const tmp = mkdtempSync(join(tmpdir(), 'stf-'));
try {
  cpSync(join(root, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  for (const f of result.files) { mkdirSync(dirname(join(tmp, f.path)), { recursive: true }); writeFileSync(join(tmp, f.path), f.content); }
  let pass = true;
  try { execFileSync(process.execPath, [join(tmp, 'scripts/check-ds-usage.mjs')], { stdio: 'pipe' }); } catch (e) { pass = false; console.log(String(e.stdout) + String(e.stderr)); }
  ok('guardrail: generated code passes check:ds', pass);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// 5. Re-ship
const edited = Object.fromEntries(result.files.filter(f => f.mode === 'edit').map(f => [f.path, f.content]));
const again = generate(snapshot, { mapping, config, existing: { ...baseExisting, ...edited } });
const routesAgain = again.files.find(f => f.path === config.paths.routes).content;
ok('re-ship: routes unchanged', routesAgain === edited[config.paths.routes]);
ok('re-ship: main.ts not touched again', !again.files.some(f => f.path === config.paths.main));

// 6. States
const multi = structuredClone(snapshot);
const base = multi.frames[0];
const card = (id, title, description) => ({ ...structuredClone(base.children[1].children[0]), id, name: 'Card', instance: { ...structuredClone(base.children[1].children[0].instance), text: { title, description } } });
const empty = structuredClone(base);
empty.id = '90:1'; empty.name = 'Team members / empty';
empty.children[3] = card('90:2', 'No members yet', 'Invite your first teammate to start collaborating.');
const error = structuredClone(base);
error.id = '91:1'; error.name = 'Team members / error';
error.children = [error.children[0], card('91:2', 'Something went wrong', "We couldn't load your team.")];
multi.frames = [base, empty, error];
const m = generate(multi, { mapping, config, existing: baseExisting });
const page = m.files.find(f => f.path.endsWith('.page.ts')).content;
const models = m.files.find(f => f.path.endsWith('.models.ts')).content;
const mocks = m.files.find(f => f.path.endsWith('.mock.ts')).content;
const routes = m.files.find(f => f.path === config.paths.routes).content;
ok('states: three states', m.states.join(',') === 'default,empty,error', m.states.join(','));
ok('states: header shared outside @switch', page.indexOf('<header') < page.indexOf('@switch (vm().state)'));
ok('states: one @case per state', ["@case ('default')", "@case ('empty')", "@case ('error')"].every(c => page.includes(c)));
ok('states: discriminated union', models.includes("| { state: 'empty' }") && models.includes("| { state: 'default'; members: Member[] }"));
ok('states: mock per state', ['TEAM_MEMBERS_DEFAULT', 'TEAM_MEMBERS_EMPTY', 'TEAM_MEMBERS_ERROR'].every(n => mocks.includes(`export const ${n}`)));
ok('states: route per state', ["path: 'team-members'", "path: 'team-members/empty'", "path: 'team-members/error'"].every(r => routes.includes(r)));
ok('states: shared form handler written once', page.split('protected submitInvite(').length === 2);
ok('states: accessor only for states with data', page.includes('defaultVm = computed') && !page.includes('emptyVm = computed') && !page.includes('errorVm = computed'));
ok('states: missing-state warning drops empty/error', !m.issues.some(i => i.rule === 'states' && i.message.includes('/ empty')));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll generator checks passed.');
process.exit(failures ? 1 : 0);
