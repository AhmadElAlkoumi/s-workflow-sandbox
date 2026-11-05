// Edits to existing repo files. These merge into what is there instead of replacing it,
// and are idempotent: shipping the same screen again produces the same file.

export interface RouteEdit {
  feature: string; // team-members
  pageClass: string; // TeamMembersPage
  mocks: { state: string; name: string; route: string }[];
  dirFromRoutes: string; // ./features/team-members
}

export function editRoutes(source: string, e: RouteEdit): string {
  let s = source.replace(/\r\n/g, '\n');
  const mockPath = `${e.dirFromRoutes}/${e.feature}.mock`;
  const pagePath = `${e.dirFromRoutes}/${e.feature}.page`;
  const loader = camelCase(e.feature);
  const escaped = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  // 1. Mock import (replace a previous one for this feature).
  s = s.replace(new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s*'${escaped(mockPath)}';\\n`), '');
  const names = e.mocks.map(m => m.name).sort();
  const importLine = names.length > 2
    ? `import {\n${names.map(n => `  ${n},`).join('\n')}\n} from '${mockPath}';\n`
    : `import { ${names.join(', ')} } from '${mockPath}';\n`;
  // End of the last import statement (exec loop: this also runs in the plugin sandbox).
  let at = 0;
  const re = /^import[\s\S]*?;\n/gm;
  for (let m = re.exec(s); m; m = re.exec(s)) at = m.index + m[0].length;
  s = s.slice(0, at) + importLine + s.slice(at);

  // 2. Lazy loader for the page.
  s = s.replace(new RegExp(`^const ${loader} = .*\\n`, 'm'), '');
  const loaderLine = `const ${loader} = () => import('${pagePath}').then(m => m.${e.pageClass});\n`;
  const exportAt = s.search(/^export const routes/m);
  if (exportAt < 0) throw new Error('app.routes.ts: could not find "export const routes"');
  // Sits right under a comment that introduces the routes; otherwise after a blank line.
  const before = s.slice(0, exportAt).replace(/\n+$/, '\n');
  const afterComment = /\/\/[^\n]*\n$/.test(before);
  s = before + (afterComment ? '' : '\n') + loaderLine + '\n' + s.slice(exportAt);

  // 3. Route entries: drop this feature's old entries, add one per state.
  s = s.replace(/(export const routes[^=]*=\s*)\[\s*\];/, '$1[\n];');
  const marker = `  // Preview routes for ${e.feature} (Ship to Frontend): one per state, so stakeholders and QA can open each directly.`;
  s = s
    .split('\n')
    .filter(l => !l.includes(`Preview routes for ${e.feature} (Ship to Frontend)`) && !new RegExp(`path:\\s*'${escaped(e.feature)}(/[^']*)?'`).test(l))
    .join('\n');
  const entries = [
    marker,
    ...e.mocks.map(m => `  { path: '${m.route}', loadComponent: ${loader}, data: { vm: ${m.name} } },`),
  ];
  const lines = s.split('\n');
  const start = lines.findIndex(l => /^export const routes/.test(l));
  let end = start;
  while (end < lines.length && !/^\];/.test(lines[end])) end++;
  if (end >= lines.length) throw new Error('app.routes.ts: could not find the end of the routes array');
  const redirect = lines.slice(start, end).findIndex(l => /path:\s*''/.test(l));
  const insertAt = redirect >= 0 ? start + redirect : end;
  lines.splice(insertAt, 0, ...entries);
  if (redirect < 0) {
    const close = lines.findIndex((l, i) => i > start && /^\];/.test(l));
    lines.splice(close, 0, `  { path: '', redirectTo: '${e.mocks[0].route}', pathMatch: 'full' },`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Route data reaches the page's `vm` input only with withComponentInputBinding(). */
export function editMain(source: string): { content: string; changed: boolean; failed: boolean } {
  if (source.includes('withComponentInputBinding')) return { content: source, changed: false, failed: false };
  let s = source;
  const call = /provideRouter\(\s*routes\s*\)/;
  const imp = /import\s*\{([^}]*)\bprovideRouter\b([^}]*)\}\s*from\s*'@angular\/router';/;
  if (!call.test(s) || !imp.test(s)) return { content: source, changed: false, failed: true };
  s = s.replace(call, 'provideRouter(routes, withComponentInputBinding())');
  s = s.replace(imp, (_m, a: string, b: string) => {
    const names = `${a}provideRouter${b}`.split(',').map(x => x.trim()).filter(Boolean);
    names.push('withComponentInputBinding');
    return `import { ${names.join(', ')} } from '@angular/router';`;
  });
  return { content: s, changed: true, failed: false };
}

const camelCase = (k: string) => k.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
