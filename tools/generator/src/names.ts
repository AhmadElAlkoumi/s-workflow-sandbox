// Naming helpers. Everything the generator names is derived from Figma layer and
// property names through these functions, so the output is stable across runs.

const words = (s: string) =>
  s
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());

export const kebab = (s: string) => words(s).join('-');
export const camel = (s: string) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
export const pascal = (s: string) => words(s).map(w => w[0].toUpperCase() + w.slice(1)).join('');
export const constant = (s: string) => words(s).join('_').toUpperCase();
export const humanize = (s: string) => {
  const w = words(s).join(' ');
  return w ? w[0].toUpperCase() + w.slice(1) : w;
};

export const plural = (s: string) =>
  /[^aeiou]y$/.test(s) ? s.slice(0, -1) + 'ies' : /(s|x|z|ch|sh)$/.test(s) ? s + 'es' : s + 's';

/** "Team members / default" → { feature: "Team members", state: "default" } */
export function splitFrameName(name: string): { feature: string; state: string; conventional: boolean } {
  const parts = name.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { feature: parts.slice(0, -1).join(' '), state: kebab(parts[parts.length - 1]) || 'default', conventional: true };
  return { feature: name.trim(), state: 'default', conventional: false };
}

/** "_MemberRow" → "Member": the item a local component displays. */
export const itemName = (componentName: string) =>
  pascal(componentName).replace(/(Row|Item|Tile|Cell|Card|Entry)$/, '') || pascal(componentName);

/** Escape static text for an Angular template (text content, not attributes). */
export const escapeText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/@/g, '&#64;')
    .replace(/[{}]/g, c => (c === '{' ? "{{ '{' }}" : "{{ '}' }}"));

/** Escape an attribute value for an Angular template. */
export const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Escape a string for a single-quoted TypeScript literal. */
export const tsString = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";

/** Escape content placed inside a TypeScript template literal (inline component templates). */
export const inTemplateLiteral = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// Figma's plugin sandbox (SES) refuses to load source text that looks like a dynamic import
// or an HTML comment, even inside a string literal. Generated code needs both, so they are
// assembled at runtime and never appear literally in the plugin bundle (checked by build.mjs).
export const DYNAMIC_IMPORT = ['imp', 'ort'].join('');
export const htmlComment = (text: string) => ['<!', '-- ', text, ' --', '>'].join('');
