// Mapping guardrail. Runs in CI. No dependencies.
// figma/mapping.json may only name Angular inputs, models, outputs and types that exist
// in the design system source, so Figma properties and Angular inputs can't drift apart.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapping = JSON.parse(readFileSync(join(root, 'figma/mapping.json'), 'utf8'));
const problems = [];

for (const [name, c] of Object.entries(mapping.components)) {
  const src = join(root, c.source);
  if (!existsSync(src)) { problems.push(`${name}: source ${c.source} does not exist`); continue; }
  const code = readFileSync(src, 'utf8');
  const members = (kind) => new Set([...code.matchAll(new RegExp(`readonly\\s+(\\w+)\\s*=\\s*${kind}\\b`, 'g'))].map(m => m[1]));
  const inputs = new Set([...members('input'), ...members('model')]);
  const outputs = members('output');
  const models = members('model');
  const types = new Set([...code.matchAll(/export\s+type\s+(\w+)/g)].map(m => m[1]));

  if (!new RegExp(`selector:\\s*'${c.selector}'`).test(code)) problems.push(`${name}: selector '${c.selector}' not found in ${c.source}`);
  if (!new RegExp(`export\\s+class\\s+${c.className}\\b`).test(code)) problems.push(`${name}: class ${c.className} not found in ${c.source}`);
  for (const [prop, p] of Object.entries(c.props)) {
    if (p.input && !inputs.has(p.input)) problems.push(`${name}.${prop}: input '${p.input}' does not exist on ${c.className}`);
    if (p.type && !types.has(p.type)) problems.push(`${name}.${prop}: type '${p.type}' is not exported from ${c.source}`);
    if (!p.input && !p.content) problems.push(`${name}.${prop}: needs "input" or "content"`);
  }
  if (c.event && !outputs.has(c.event)) problems.push(`${name}: output '${c.event}' does not exist on ${c.className}`);
  if (c.model && !models.has(c.model)) problems.push(`${name}: model '${c.model}' does not exist on ${c.className}`);
  if (c.typeInput && !inputs.has(c.typeInput)) problems.push(`${name}: input '${c.typeInput}' does not exist on ${c.className}`);
  if (c.submit && !inputs.has(c.submit.input)) problems.push(`${name}: input '${c.submit.input}' does not exist on ${c.className}`);
  if (c.props.label?.content && !/<ng-content/.test(code)) problems.push(`${name}: label maps to content but ${c.className} has no <ng-content>`);
}

const index = readFileSync(join(root, 'src/ds/index.ts'), 'utf8');
for (const c of Object.values(mapping.components)) {
  const rel = './' + c.source.replace(/^src\/ds\//, '').replace(/\.ts$/, '');
  if (!index.includes(`'${rel}'`)) problems.push(`${c.className}: ${c.source} is not exported from src/ds/index.ts (@ds/ui)`);
}

if (problems.length) {
  console.error(`check:mapping — ${problems.length} problem(s) in figma/mapping.json:\n`);
  console.error(problems.map(p => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check:mapping — ${Object.keys(mapping.components).length} component(s) map to real Angular inputs.`);
