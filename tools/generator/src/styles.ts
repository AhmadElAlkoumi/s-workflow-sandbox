// A tiny Sass writer: rules with declarations and nested rules, formatted the way the
// repo's hand-written files are (short rules on one line, blank line between rules).

/** A declaration without its semicolon, e.g. "gap: var(--ds-spacing-lg)" or "@include ds-type(body-md)". */
export interface Decl {
  text: string;
  /** Trailing comment, e.g. "ds-allow: page max width (no layout token yet)". */
  comment?: string;
}

export interface Rule {
  selector: string;
  decls: Decl[];
  nested: Rule[];
}

export const d = (text: string, comment?: string): Decl => (comment ? { text, comment } : { text });
export const rule = (selector: string, decls: Decl[] = [], nested: Rule[] = []): Rule => ({ selector, decls, nested });

const MAX = 100;
const fmt = (x: Decl) => `${x.text};${x.comment ? ` // ${x.comment}` : ''}`;

function writeRule(r: Rule, indent: string): string[] {
  // A comment exempts its whole line from the guardrail, so commented declarations always
  // get a line of their own.
  if (!r.nested.length && !r.decls.some(x => x.comment)) {
    const line = `${indent}${r.selector} { ${r.decls.map(fmt).join(' ')} }`;
    if (line.length <= MAX) return [line];
  }
  const out = [`${indent}${r.selector} {`];
  for (const x of r.decls) out.push(`${indent}  ${fmt(x)}`);
  if (r.nested.length) {
    if (r.decls.length) out.push('');
    for (const n of r.nested) out.push(...writeRule(n, indent + '  '));
  }
  out.push(`${indent}}`);
  return out;
}

export const isEmpty = (r: Rule): boolean => !r.decls.length && r.nested.every(isEmpty);

function prune(r: Rule): Rule {
  return { ...r, nested: r.nested.filter(n => !isEmpty(n)).map(prune) };
}

export function writeSheet(rules: Rule[]): string {
  const blocks = rules.filter(r => !isEmpty(r)).map(r => writeRule(prune(r), '').join('\n'));
  return `@use 'tokens' as *;\n\n${blocks.join('\n\n')}\n`;
}
