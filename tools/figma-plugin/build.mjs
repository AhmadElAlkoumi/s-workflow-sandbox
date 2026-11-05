// Builds the plugin into tools/figma-plugin/dist (code.js + ui.html).
//   npm run plugin:build                         → no service (check + preview only)
//   SHIP_SERVICE_URL=https://… npm run plugin:build → push enabled
// The service URL must also be listed in manifest.json networkAccess.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });

const bundle = (outfile, relaunch) => build({
  entryPoints: [join(here, 'src/code.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2017', // the plugin sandbox; also keeps the bundle free of newer syntax
  outfile,
  define: { __RELAUNCH_COMMAND__: JSON.stringify(relaunch) },
  logLevel: 'warning',
});
await bundle(join(dist, 'code.js'), '');

const service = (process.env.SHIP_SERVICE_URL ?? '').replace(/\/$/, '');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const allowed = [...(manifest.networkAccess.allowedDomains ?? []), ...(manifest.networkAccess.devAllowedDomains ?? [])];
if (service && !allowed.some(d => service.startsWith(d))) {
  console.error(`SHIP_SERVICE_URL ${service} is not in manifest.json networkAccess; Figma would block it.`);
  process.exit(1);
}
const ui = readFileSync(join(here, 'src/ui.html'), 'utf8').replace('__SERVICE_URL__', service);
writeFileSync(join(dist, 'ui.html'), ui);
// Fail loudly if an output is missing (both files are what Figma loads from manifest.json).
for (const f of [manifest.main, manifest.ui]) if (!existsSync(join(here, f))) { console.error(`missing ${f}`); process.exit(1); }
console.log(`plugin built → ${dist} (service: ${service || 'none'})`);

// Figma-hosted build (a "generative plugin" in the account library). Figma builds it from a
// single, lint-clean TypeScript file, so the generator sources are concatenated (not bundled)
// into one code.ts. No network access there: it checks and previews but does not push.
//   SHIP_GENERATIVE_ID=<plugin id> npm run plugin:build  → dist/generative/{code.ts,ui.html}
const generativeId = process.env.SHIP_GENERATIVE_ID;
if (generativeId) {
  const out = join(dist, 'generative');
  mkdirSync(out, { recursive: true });
  const gen = (f) => readFileSync(join(here, '../generator/src', f), 'utf8');
  const strip = (src) => src
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace(/^declare const figma: any;\n/m, '')
    .replace(/^export (?=(async )?function |const |interface |type )/gm, '');
  const json = (f) => readFileSync(join(here, '../..', f), 'utf8').trim();
  const main = readFileSync(join(here, 'src/code.ts'), 'utf8')
    .replace(/^import bundledMapping from .*\n/m, `const bundledMapping = ${json('figma/mapping.json')};\n`)
    .replace(/^import bundledConfig from .*\n/m, `const bundledConfig = ${json('.ship-to-frontend.json')};\n`)
    .replace(/^declare const (figma|__html__|__RELAUNCH_COMMAND__)[^\n]*\n/gm, '')
    .replace(/^\/\/ Set at build time for the Figma-hosted.*\n/m, '')
    .replace(/__RELAUNCH_COMMAND__/g, 'RELAUNCH_COMMAND');
  const parts = ['types.ts', 'names.ts', 'styles.ts', 'readiness.ts', 'repo-edits.ts', 'generate.ts', 'serialize.ts']
    .map(f => `// ── generator/src/${f} ──\n${strip(gen(f))}`);
  // Everything runs inside one function scope so no name leaks into the plugin's globals.
  const code = [
    '// Ship to Frontend, Figma-hosted build. Generated from tools/generator/src and',
    '// tools/figma-plugin/src/code.ts by tools/figma-plugin/build.mjs. Do not edit here.',
    '',
    'function shipToFrontend(): void {',
    `const RELAUNCH_COMMAND: string = ${JSON.stringify(generativeId)};`,
    '',
    ...parts,
    '// ── figma-plugin/src/code.ts ──',
    strip(main),
    '}',
    '',
    'shipToFrontend();',
    '',
  ].join('\n');
  // Whole-line comments and blank lines are dropped to keep the upload small. The sources have no
  // multi-line template literals, so no string content is touched; tests compare compiled output.
  const lean = code.split('\n').filter((l, i) => i < 2 || !/^\s*(\/\/|\/\*\*|\*\/|\* |\*$|$)/.test(l)).join('\n') + '\n';
  writeFileSync(join(out, 'code.full.ts'), code);
  writeFileSync(join(out, 'code.ts'), lean);
  writeFileSync(join(out, 'ui.html'), readFileSync(join(here, 'src/ui.html'), 'utf8').replace('__SERVICE_URL__', ''));
  console.log(`generative build → ${out} (relaunch command ${generativeId})`);
}
