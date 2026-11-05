// Builds the plugin into tools/figma-plugin/dist (code.js + ui.html).
//   npm run plugin:build                         → no service (check + preview only)
//   SHIP_SERVICE_URL=https://… npm run plugin:build → push enabled
// The service URL must also be listed in manifest.json networkAccess.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(here, 'src/code.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2017', // the plugin sandbox; also keeps the bundle free of newer syntax
  outfile: join(dist, 'code.js'),
  logLevel: 'warning',
});

const service = (process.env.SHIP_SERVICE_URL ?? '').replace(/\/$/, '');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const allowed = [...(manifest.networkAccess.allowedDomains ?? []), ...(manifest.networkAccess.devAllowedDomains ?? [])];
if (service && !allowed.some(d => service.startsWith(d))) {
  console.error(`SHIP_SERVICE_URL ${service} is not in manifest.json networkAccess; Figma would block it.`);
  process.exit(1);
}
const ui = readFileSync(join(here, 'src/ui.html'), 'utf8').replace('__SERVICE_URL__', service);
writeFileSync(join(dist, 'ui.html'), ui);
console.log(`plugin built → ${dist} (service: ${service || 'none'})`);
