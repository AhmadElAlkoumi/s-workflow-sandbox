// The deterministic generator: Snapshot → Angular page, Sass, view model, mocks, local
// components and route edits. Same input, same output: no AI, no randomness, no clock.
import {
  camel, constant, escapeAttr, escapeText, humanize, inTemplateLiteral, itemName, kebab, pascal, plural, splitFrameName, tsString,
} from './names';
import { checkReadiness, libraryComponent } from './readiness';
import { editMain, editRoutes } from './repo-edits';
import { d, Decl, rule, Rule, writeSheet } from './styles';
import type { Bindable, ComponentMap, GeneratedFile, GenerateResult, Issue, Mapping, ShipConfig, SNode, Snapshot } from './types';

export interface GenerateOptions {
  mapping: Mapping;
  config: ShipConfig;
  /** Current content of files the generator edits, keyed by repo path (routes, main.ts). */
  existing?: Record<string, string>;
}

type Lib = ComponentMap & { name: string };

// ── Local feature components ────────────────────────────────────────────────

interface ItemField {
  name: string;
  tsType: string;
  /** How a usage instance provides the value. */
  source: { kind: 'id' } | { kind: 'text'; prop: string } | { kind: 'nested'; defId: string; prop: string; variant: boolean } | { kind: 'enum'; defId: string };
}

interface EnumDef {
  field: string;
  typeName: string;
  constName: string;
  lib: Lib;
  /** enum key → props of the nested instance */
  values: Map<string, { variant: Record<string, string>; text: Record<string, string> }>;
  varyingVariant: string[];
  varyingText: string[];
}

interface LocalComp {
  def: SNode;
  item: string; // Member
  input: string; // member
  selector: string;
  className: string;
  file: string; // member-row.component
  fields: ItemField[];
  enums: Map<string, EnumDef>; // by nested def id
  nestedFields: Map<string, ItemField[]>; // varying nested props by nested def id
  outputs: Map<string, string>; // output name → emitted type
  usages: SNode[];
  dsImports: Set<string>;
  typeImports: Set<string>;
  template: string[];
  rules: Rule[];
}

// ── Render context ──────────────────────────────────────────────────────────

interface StateData {
  state: string;
  fields: { name: string; type: string; mock: unknown[] | unknown }[];
}

interface Ctx {
  rules: Rule[];
  classes: Map<string, string>; // class → owner signature, to keep names unique per file
  dsImports: Set<string>;
  usesRouter: { value: boolean };
  local?: LocalComp;
  page: PageState;
  data?: StateData;
  dataRoot: string;
  form?: FormState;
}

interface FormState {
  cls: string;
  fields: { key: string; signal: string }[];
  submitButtonId?: string;
}

interface PageState {
  outputs: Map<string, string>;
  signals: string[];
  methods: string[];
  locals: Map<string, LocalComp>;
  notes: string[];
  issues: Issue[];
  fixedSizes: string[];
  snapshot: Snapshot;
  mapping: Mapping;
  config: ShipConfig;
}

const CONTAINERS = new Set(['FRAME', 'COMPONENT', 'GROUP', 'SECTION']);

export function generate(snapshot: Snapshot, opts: GenerateOptions): GenerateResult {
  const { mapping, config } = opts;
  const issues = checkReadiness(snapshot, mapping, config);

  // States, default first.
  const frames = snapshot.frames.map(f => ({ frame: f, ...splitFrameName(f.name) }));
  const featureTitle = frames[0]?.feature ?? 'Screen';
  const ownFrames = frames.filter(f => f.feature === featureTitle).sort((a, b) => (a.state === 'default' ? -1 : b.state === 'default' ? 1 : 0));
  const feature = kebab(featureTitle);
  const Pascal = pascal(featureTitle);
  const CONST = constant(featureTitle);
  const dir = `${config.paths.features}/${feature}`;

  const page: PageState = {
    outputs: new Map(), signals: [], methods: [], locals: new Map(), notes: [], issues, fixedSizes: [], snapshot, mapping, config,
  };
  const pageCtxBase = { rules: [] as Rule[], classes: new Map<string, string>(), dsImports: new Set<string>(), usesRouter: { value: false }, page };
  const multi = ownFrames.length > 1;

  // Render every state's children into chunks; shared leading chunks stay outside the @switch.
  const host = rule(':host');
  pageCtxBase.rules.push(host);
  const states: { state: string; chunks: string[][]; data: StateData }[] = [];
  for (const f of ownFrames) {
    const data: StateData = { state: f.state, fields: [] };
    const ctx: Ctx = { ...pageCtxBase, data, dataRoot: multi ? `${camel(f.state)}Vm()!` : 'vm()' };
    if (f === ownFrames[0]) host.decls.push(...boxDecls(f.frame, null, ctx, true));
    const chunks = renderableKids(f.frame).map(group => renderGroup(group, f.frame, ctx, host));
    states.push({ state: f.state, chunks, data });
  }
  let shared = 0;
  if (multi) {
    const first = states[0].chunks;
    while (shared < first.length && states.every(s => s.chunks[shared] && s.chunks[shared].join('\n') === first[shared].join('\n'))) shared++;
  }

  const tpl: string[] = [];
  const pushChunks = (chunks: string[][], indent: string) => {
    chunks.forEach((c, i) => {
      if (i) tpl.push('');
      for (const l of c) tpl.push(l ? indent + l : '');
    });
  };
  if (!multi) pushChunks(states[0].chunks, '');
  else {
    pushChunks(states[0].chunks.slice(0, shared), '');
    if (shared) tpl.push('');
    tpl.push('@switch (vm().state) {');
    for (const s of states) {
      tpl.push(`  @case (${tsString(s.state)}) {`);
      pushChunks(s.chunks.slice(shared), '    ');
      tpl.push('  }');
    }
    tpl.push('}');
  }

  // ── Models and mocks ──
  const vmType = `${Pascal}Vm`;
  const modelLines: string[] = [
    `// View model for the ${featureTitle} screen, generated from the Figma frames.`,
    '// This is the contract between design and frontend: the page renders anything',
    '// that matches these types. Frontend maps the real API response to it.',
    '',
  ];
  const modelTypeImports = new Set<string>();
  for (const lc of page.locals.values()) {
    for (const t of lc.typeImports) modelTypeImports.add(t);
  }
  if (modelTypeImports.size) modelLines.splice(4, 0, `import type { ${[...modelTypeImports].sort().join(', ')} } from '${mapping.library.import}';`, '');
  for (const lc of page.locals.values()) {
    for (const e of lc.enums.values()) {
      modelLines.push(`export type ${e.typeName} = ${[...e.values.keys()].map(tsString).join(' | ')};`, '');
    }
    modelLines.push(`export interface ${lc.item} {`, ...lc.fields.map(f => `  ${f.name}: ${f.tsType};`), '}', '');
  }
  const variantType = (s: StateData) =>
    `{ state: ${tsString(s.state)}${s.fields.map(f => `; ${f.name}: ${f.type}`).join('')} }`;
  if (states.length === 1) modelLines.push(`export type ${vmType} = ${variantType(states[0].data)};`);
  else modelLines.push(`export type ${vmType} =`, ...states.map((s, i) => `  | ${variantType(s.data)}${i === states.length - 1 ? ';' : ''}`));

  const mockNames: { state: string; name: string; route: string }[] = [];
  const mockLines: string[] = [
    `import { ${vmType} } from './${feature}.models';`,
    '',
    '// Mock data for previews and stakeholder review: one per state frame in Figma,',
    '// filled from the frame\'s content. Frontend replaces this with real data.',
  ];
  for (const s of states) {
    const name = `${CONST}_${constant(s.state)}`;
    const route = s.state === 'default' ? feature : `${feature}/${s.state}`;
    mockNames.push({ state: s.state, name, route });
    const body = [`  state: ${tsString(s.state)},`];
    for (const f of s.data.fields) {
      if (Array.isArray(f.mock)) {
        body.push(`  ${f.name}: [`, ...f.mock.map(m => `    ${literal(m)},`), '  ],');
      } else body.push(`  ${f.name}: ${literal(f.mock)},`);
    }
    mockLines.push(`export const ${name}: ${vmType} = {`, ...body, '};', '');
  }

  // ── Page component ──
  const pageClass = `${Pascal}Page`;
  const core = new Set(['ChangeDetectionStrategy', 'Component', 'input']);
  if (page.outputs.size) core.add('output');
  if (page.signals.length) core.add('signal');
  if (multi) core.add('computed');
  const typeRefs = new Set<string>([vmType]);
  for (const t of page.outputs.values()) for (const lc of page.locals.values()) if (t === lc.item) typeRefs.add(lc.item);
  const imports = [`import { ${[...core].sort().join(', ')} } from '@angular/core';`];
  if (pageCtxBase.usesRouter.value) imports.push(`import { RouterLink } from '@angular/router';`);
  if (pageCtxBase.dsImports.size) imports.push(`import { ${[...pageCtxBase.dsImports].sort().join(', ')} } from '${mapping.library.import}';`);
  for (const lc of page.locals.values()) imports.push(`import { ${lc.className} } from './${lc.file}';`);
  imports.push(`import { ${[...typeRefs].sort().join(', ')} } from './${feature}.models';`);
  const componentImports = [...[...pageCtxBase.dsImports].sort(), ...[...page.locals.values()].map(l => l.className), ...(pageCtxBase.usesRouter.value ? ['RouterLink'] : [])];

  const pageName = snapshot.pageName ? `${snapshot.pageName} / ` : '';
  const header = [
    ...ownFrames.map(f => `// Figma: ${pageName}${f.frame.name}  (node ${f.frame.id})`),
    '// Generated by Ship to Frontend. Presentational only: data comes in through `vm`,',
    '// user intent goes out through outputs. Frontend connects `vm` to the real API.',
  ];
  const body: string[] = [`  readonly vm = input.required<${vmType}>();`];
  if (page.outputs.size) body.push('', ...[...page.outputs].map(([n, t]) => `  readonly ${n} = output<${t}>();`));
  if (multi) {
    // Narrowed accessors, only for states that carry data.
    for (const s of states.filter(x => x.data.fields.length)) {
      body.push('', `  protected readonly ${camel(s.state)}Vm = computed(() => {`, '    const vm = this.vm();', `    return vm.state === ${tsString(s.state)} ? vm : null;`, '  });');
    }
  }
  if (page.signals.length) body.push('', ...page.signals.map(s => `  ${s}`));
  for (const m of page.methods) body.push('', ...m.split('\n').map(l => `  ${l}`));

  const inline = config.naming.templates !== 'file';
  const pageTs = [
    ...imports,
    '',
    ...header,
    '@Component({',
    `  selector: '${config.naming.pageSelectorPrefix}-${feature}-page',`,
    '  changeDetection: ChangeDetectionStrategy.OnPush,',
    `  imports: [${componentImports.join(', ')}],`,
    ...(inline
      ? ['  template: `', ...tpl.map(l => (l ? '    ' + inTemplateLiteral(l) : '')), '  `,']
      : [`  templateUrl: './${feature}.page.html',`]),
    `  styleUrl: './${feature}.page.scss',`,
    '})',
    `export class ${pageClass} {`,
    ...body,
    '}',
    '',
  ].join('\n');

  const files: GeneratedFile[] = [
    { path: `${dir}/${feature}.page.ts`, content: pageTs, mode: 'create' },
    ...(inline ? [] : [{ path: `${dir}/${feature}.page.html`, content: tpl.join('\n') + '\n', mode: 'create' as const }]),
    { path: `${dir}/${feature}.page.scss`, content: writeSheet(pageCtxBase.rules), mode: 'create' },
    { path: `${dir}/${feature}.models.ts`, content: modelLines.join('\n').replace(/\n+$/, '') + '\n', mode: 'create' },
    { path: `${dir}/${feature}.mock.ts`, content: mockLines.join('\n').replace(/\n+$/, '') + '\n', mode: 'create' },
  ];
  for (const lc of page.locals.values()) files.push(...renderLocalFiles(lc, dir, page));

  // ── Repo edits ──
  const routesPath = config.paths.routes;
  const routes = editRoutes(opts.existing?.[routesPath] ?? DEFAULT_ROUTES, { feature, pageClass, mocks: mockNames, dirFromRoutes: `./features/${feature}` });
  files.push({ path: routesPath, content: routes, mode: 'edit' });
  const mainPath = config.paths.main;
  if (opts.existing?.[mainPath] !== undefined) {
    const main = editMain(opts.existing[mainPath]);
    if (main.changed) files.push({ path: mainPath, content: main.content, mode: 'edit' });
    if (main.failed) page.notes.push('`src/main.ts` could not be updated automatically: add `withComponentInputBinding()` to `provideRouter` so route mocks reach the page.');
  }

  // ── Gaps and PR ──
  const gaps = collectGaps(page, ownFrames[0]?.frame, mapping);
  const blocked = issues.some(i => i.severity === 'block');
  const outputs = [...page.outputs].map(([name, type]) => ({ name, type }));
  const designBranch = config.designBranch.replace('{feature}', feature);
  const projectBranch = config.projectBranch.replace('{feature}', feature);
  const prTitle = `${featureTitle} screen (designer UI build)`;
  const prBody = buildPrBody({ featureTitle, snapshot, frames: ownFrames.map(f => f.frame), mockNames, issues, gaps, outputs, notes: page.notes, config, locals: [...page.locals.values()] });

  return {
    feature, featureTitle, states: states.map(s => s.state), issues, blocked, files, gaps, outputs,
    routes: mockNames.map(m => `/${m.route}`), designBranch, projectBranch, prTitle, prBody,
  };
}

const DEFAULT_ROUTES = `import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n`;

// ── Rendering ───────────────────────────────────────────────────────────────

/** Visible children, with consecutive instances of the same local component grouped. */
function renderableKids(n: SNode): SNode[][] {
  const out: SNode[][] = [];
  for (const c of n.children ?? []) {
    if (!c.visible) continue;
    const prev = out[out.length - 1];
    const localKey = c.type === 'INSTANCE' && c.instance && c.children ? c.instance.key : null;
    if (localKey && prev && prev[0].type === 'INSTANCE' && prev[0].instance?.key === localKey) prev.push(c);
    else out.push([c]);
  }
  return out;
}

function renderGroup(group: SNode[], parent: SNode, ctx: Ctx, parentRule: Rule): string[] {
  const n = group[0];
  if (n.type === 'INSTANCE' && n.instance && n.children && !libraryComponent(ctx.page.mapping, n.instance.key)) {
    return renderLocalUsage(group, parent, ctx);
  }
  return flatMap(group, g => renderNode(g, parent, ctx, parentRule));
}

function renderNode(n: SNode, parent: SNode, ctx: Ctx, parentRule: Rule): string[] {
  if (n.type === 'TEXT') return renderText(n, parent, ctx, parentRule);
  if (n.type === 'INSTANCE') {
    const lib = n.instance ? libraryComponent(ctx.page.mapping, n.instance.key) : undefined;
    if (lib) return renderLibrary(n, lib, parent, ctx);
    return [`<!-- Skipped "${n.name}": unmapped component -->`];
  }
  if (CONTAINERS.has(n.type)) return renderContainer(n, parent, ctx);
  if (n.type === 'RECTANGLE') {
    const cls = allocClass(ctx, kebab(n.name) || 'shape', n.id);
    ctx.rules.push(rule(`.${cls}`, [...boxDecls(n, parent, ctx, false), ...fixedSize(n, ctx, 'shape')]));
    return [`<div class="${cls}" aria-hidden="true"></div>`];
  }
  return [`<!-- Skipped "${n.name}" (${n.type.toLowerCase()}): not exported yet -->`];
}

function tagFor(name: string, mapping: Mapping): { tag: string; cls: string } {
  const k = kebab(name) || 'box';
  for (const [pattern, tag] of Object.entries(mapping.layerNames)) {
    if (pattern.startsWith('*-')) {
      const suffix = pattern.slice(1);
      if (k.endsWith(suffix) && k !== suffix.slice(1)) return { tag, cls: k.slice(0, -suffix.length) };
    } else if (k === pattern) return { tag, cls: k };
  }
  return { tag: 'div', cls: k };
}

function renderContainer(n: SNode, parent: SNode, ctx: Ctx): string[] {
  const { tag, cls: base } = tagFor(n.name, ctx.page.mapping);
  const cls = allocClass(ctx, base, n.id);
  const r = rule(`.${cls}`, boxDecls(n, parent, ctx, false));
  ctx.rules.push(r);
  if (n.layout === null || n.type === 'GROUP') {
    r.decls.push(d('position: relative'), ...fixedSize(n, ctx, 'container'));
    r.decls = dedupeDecls(r.decls);
  }

  const attrs = [`class="${cls}"`];
  if (tag === 'section') attrs.push(`aria-label="${escapeAttr(humanize(cls))}"`);
  let form: FormState | undefined;
  if (tag === 'form') {
    form = { cls, fields: [] };
    const buttons = (n.children ?? []).filter(c => c.visible && c.type === 'INSTANCE' && libraryComponent(ctx.page.mapping, c.instance?.key)?.submit);
    form.submitButtonId = buttons[buttons.length - 1]?.id;
    attrs.push(`(submit)="$event.preventDefault(); submit${pascal(cls)}()"`);
  }
  const childCtx: Ctx = form ? { ...ctx, form } : ctx;
  const inner = flatMap(renderableKids(n), g => renderGroup(g, n, childCtx, r));
  if (form) finishForm(form, ctx);
  const open = `<${tag} ${attrs.join(' ')}>`;
  if (!inner.length) return [`${open}</${tag}>`];
  return [open, ...inner.map(l => '  ' + l), `</${tag}>`];
}

function finishForm(form: FormState, ctx: Ctx) {
  const name = uniqueOutput(ctx.page, camel(form.cls), form.fields.length === 1 ? 'string' : `{ ${form.fields.map(f => `${f.key}: string`).join('; ')} }`);
  const m = `submit${pascal(form.cls)}`;
  // A form shared by several state frames is rendered once per state; its handler is written once.
  if (ctx.page.methods.some(x => x.startsWith(`protected ${m}(`))) return;
  if (form.fields.length === 1) {
    const f = form.fields[0];
    ctx.page.methods.push([
      `protected ${m}(): void {`,
      `  const ${f.key} = this.${f.signal}().trim();`,
      `  if (${f.key}) this.${name}.emit(${f.key});`,
      '}',
    ].join('\n'));
  } else {
    ctx.page.methods.push([
      `protected ${m}(): void {`,
      `  this.${name}.emit({ ${form.fields.map(f => `${f.key}: this.${f.signal}().trim()`).join(', ')} });`,
      '}',
    ].join('\n'));
  }
}

function renderText(n: SNode, parent: SNode, ctx: Ctx, parentRule: Rule): string[] {
  const style = n.text?.style ? ctx.page.mapping.textStyles[n.text.style] : undefined;
  const tag = style?.tag ?? 'span';
  const decls: Decl[] = [];
  if (/^(h[1-6]|p)$/.test(tag)) decls.push(d('margin: 0'));
  if (style) decls.push(d(`@include ds-type(${style.type})`));
  if (n.text?.fill) decls.push(d(`color: ${paint(n.text.fill, ctx)}`));
  if (n.text?.truncate) {
    if (!n.text.maxLines || n.text.maxLines <= 1) decls.push(d('overflow: hidden'), d('text-overflow: ellipsis'), d('white-space: nowrap'));
    else decls.push(d('display: -webkit-box'), d(`-webkit-line-clamp: ${n.text.maxLines}`), d('-webkit-box-orient: vertical'), d('overflow: hidden'));
  }
  decls.push(...childSizing(n, parent, ctx));

  // Text content: bound to the item inside a local component, static otherwise.
  const content = n.text?.prop && ctx.local ? `{{ ${ctx.local.input}().${camel(n.text.prop)} }}` : escapeText(n.text?.characters ?? '');

  // A text whose tag is unique among its siblings is styled by tag under its parent (".title h1");
  // otherwise it gets a class.
  const siblings = (parent.children ?? []).filter(c => c.visible && c.type === 'TEXT');
  const sameTag = siblings.filter(c => (c.text?.style ? ctx.page.mapping.textStyles[c.text.style]?.tag : 'span') === tag);
  const isRootLevel = parentRule.selector === ':host';
  if (sameTag.length === 1 && !isRootLevel) {
    parentRule.nested.push(rule(tag, decls));
    return [`<${tag}>${content}</${tag}>`];
  }
  const cls = allocClass(ctx, kebab(n.name) || 'text', n.id);
  ctx.rules.push(rule(`.${cls}`, decls));
  return [`<${tag} class="${cls}">${content}</${tag}>`];
}

function renderLibrary(n: SNode, lib: Lib, parent: SNode, ctx: Ctx, bindings?: Record<string, string>): string[] {
  const inst = n.instance!;
  (ctx.local?.dsImports ?? ctx.dsImports).add(lib.className);
  const attrs: string[] = [];
  let content = '';
  const fieldKey = lib.model ? inputFieldKey(inst) : undefined;

  // Class only when the instance needs layout rules of its own.
  const sizing = childSizing(n, parent, ctx);
  if (sizing.length) {
    const renamed = n.name !== inst.name && n.name !== lib.name;
    const base = `${tagFor(parent.name, ctx.page.mapping).cls}__${kebab(renamed ? n.name : fieldKey ?? lib.name)}`;
    const cls = allocClass(ctx, base, n.id);
    ctx.rules.push(rule(`.${cls}`, sizing));
    attrs.push(`class="${cls}"`);
  }
  if (lib.typeInput && fieldKey === 'email') attrs.push(`${lib.typeInput}="email"`);
  for (const [prop, pm] of Object.entries(lib.props)) {
    const bound = bindings?.[prop];
    const value = inst.variant[prop] ?? inst.text[prop];
    if (pm.content) {
      content = bound ? `{{ ${bound} }}` : escapeText(value ?? '');
    } else if (pm.input) {
      if (bound) attrs.push(`[${pm.input}]="${bound}"`);
      else if (value !== undefined) attrs.push(`${pm.input}="${escapeAttr(value)}"`);
    }
  }
  const isSubmit = ctx.form && ctx.form.submitButtonId === n.id && lib.submit;
  if (isSubmit) attrs.push(`${lib.submit!.input}="${lib.submit!.value}"`);
  if (lib.model && ctx.form && fieldKey) {
    const signal = `${camel(ctx.form.cls)}${pascal(fieldKey)}`;
    ctx.form.fields.push({ key: fieldKey, signal });
    if (!ctx.page.signals.some(s => s.includes(` ${signal} `))) ctx.page.signals.push(`protected readonly ${signal} = signal('');`);
    attrs.push(`[(${lib.model})]="${signal}"`);
  }
  const nav = navigation(n, ctx);
  if (nav) {
    attrs.push(`routerLink="${nav}"`);
    ctx.usesRouter.value = true;
  } else if (lib.event && !isSubmit) {
    const label = inst.text.label ?? n.name;
    if (ctx.local) {
      const name = camel(label) || 'pressed';
      ctx.local.outputs.set(name, ctx.local.item);
      attrs.push(`(${lib.event})="${name}.emit(${ctx.local.input}())"`);
    } else {
      const name = uniqueOutput(ctx.page, camel(label) || 'pressed', 'void');
      attrs.push(`(${lib.event})="${name}.emit()"`);
    }
  }

  const open = `<${lib.selector}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  const close = lib.selfClosing && !content ? ' />' : `>${content}</${lib.selector}>`;
  const oneLine = open + close;
  if (oneLine.length <= 100 || attrs.length < 2) return [oneLine];
  return [`<${lib.selector}`, ...attrs.map((a, i) => `  ${a}${i === attrs.length - 1 ? close : ''}`)];
}

/** "Invite by email" + placeholder "teammate@acme.io" → "email". */
function inputFieldKey(inst: NonNullable<SNode['instance']>): string {
  const ph = inst.text.placeholder ?? '';
  const label = inst.text.label ?? '';
  if (/\S+@\S+\.\S+/.test(ph) || /\bemail\b/i.test(label)) return 'email';
  if (/\bpassword\b/i.test(label)) return 'password';
  return camel(label) || 'value';
}

function navigation(n: SNode, ctx: Ctx): string | undefined {
  const r = n.reactions?.find(x => x.action === 'NAVIGATE' && x.destinationId);
  if (!r) return undefined;
  const dest = r.destinationName ?? ctx.page.snapshot.frames.find(f => f.id === r.destinationId)?.name;
  if (!dest) return undefined;
  const { feature, state } = splitFrameName(dest);
  return `/${kebab(feature)}${state === 'default' ? '' : '/' + state}`;
}

function uniqueOutput(page: PageState, name: string, type: string): string {
  let n = name;
  if (n === 'vm') n = 'vmChange';
  if (page.outputs.has(n) && page.outputs.get(n) !== type) n = `${name}Clicked`;
  let i = 2;
  while (page.outputs.has(n) && page.outputs.get(n) !== type) n = `${name}${i++}`;
  page.outputs.set(n, type);
  return n;
}

function allocClass(ctx: Ctx, base: string, owner: string): string {
  let cls = base;
  let i = 2;
  while (ctx.classes.has(cls) && ctx.classes.get(cls) !== owner) cls = `${base}-${i++}`;
  ctx.classes.set(cls, owner);
  return cls;
}

// ── Layout → Sass ───────────────────────────────────────────────────────────

function cssVar(name: string, ctx: Ctx): string {
  const css = ctx.page.snapshot.variables[name] ?? `--ds-${name.replace(/\//g, '-')}`;
  return `var(${css})`;
}

function val(b: Bindable, ctx: Ctx): string {
  return b.variable ? cssVar(b.variable, ctx) : b.value === 0 ? '0' : `${b.value}px`;
}

function paint(p: { variable?: string; hex?: string }, ctx: Ctx): string {
  return p.variable ? cssVar(p.variable, ctx) : p.hex ?? 'currentColor';
}

function boxDecls(n: SNode, parent: SNode | null, ctx: Ctx, isRoot: boolean): Decl[] {
  const out: Decl[] = [];
  const L = n.layout;
  const kids = (n.children ?? []).filter(c => c.visible && !c.absolute);
  if (L) {
    out.push(d('display: flex'));
    if (L.mode === 'VERTICAL') out.push(d('flex-direction: column'));
    const align = alignItems(n);
    if (align) out.push(d(`align-items: ${align}`));
    const justify = { SPACE_BETWEEN: 'space-between', CENTER: 'center', MAX: 'flex-end' }[L.main as string];
    if (justify) out.push(d(`justify-content: ${justify}`));
    if (L.gap.value > 0 && L.main !== 'SPACE_BETWEEN' && kids.length > 1) out.push(d(`gap: ${val(L.gap, ctx)}`));
    if (L.wrap) out.push(d('flex-wrap: wrap'));
  }
  if (isRoot) {
    if (n.sizing.h === 'FIXED') {
      out.push(d(`max-width: ${n.width}px`, 'ds-allow: page max width (no layout token yet, see PR "Design system gaps")'), d('margin: 0 auto'));
      ctx.page.fixedSizes.push(`page max width ${n.width}px`);
    }
  } else if (parent) out.push(...childSizing(n, parent, ctx));
  if (L) {
    const [t, r, b, l] = L.padding.map(p => val(p, ctx));
    if ([t, r, b, l].some(v => v !== '0')) {
      out.push(d(`padding: ${t === b && r === l ? (t === r ? t : `${t} ${r}`) : `${t} ${r} ${b} ${l}`}`));
    }
  }
  const fill = n.fills[n.fills.length - 1];
  if (fill && fill.type === 'SOLID' && !(isRoot && fill.variable === ctx.page.config.canvasToken)) out.push(d(`background: ${paint(fill, ctx)}`));
  const stroke = n.strokes[n.strokes.length - 1];
  if (stroke && n.strokeWeights) {
    const [t, r, b, l] = n.strokeWeights;
    const line = (w: number) => `${w}px solid ${paint(stroke, ctx)}`;
    if (t === r && r === b && b === l) {
      if (t > 0) out.push(d(`border: ${line(t)}`));
    } else {
      const sides: [string, number][] = [['top', t], ['right', r], ['bottom', b], ['left', l]];
      for (const [side, w] of sides) if (w > 0) out.push(d(`border-${side}: ${line(w)}`));
    }
  }
  if (n.radius) out.push(d(`border-radius: ${val(n.radius, ctx)}`));
  if (n.clips && n.radius && !isRoot) out.push(d('overflow: hidden'));
  return out;
}

function alignItems(n: SNode): string | undefined {
  const L = n.layout!;
  if (L.cross === 'CENTER') return 'center';
  if (L.cross === 'MAX') return 'flex-end';
  if (L.cross === 'BASELINE') return 'baseline';
  const kids = (n.children ?? []).filter(c => c.visible && !c.absolute);
  if (L.mode === 'HORIZONTAL') {
    // CSS stretches by default; Figma top-aligns. Only differs when heights differ.
    const hs = new Set(kids.filter(k => k.sizing.v !== 'FILL').map(k => k.height));
    return hs.size > 1 ? 'flex-start' : undefined;
  }
  // Column: text and Fill children look the same stretched; Hug boxes (buttons) must not stretch.
  const boxes = kids.filter(k => k.type !== 'TEXT');
  if (boxes.length && boxes.every(k => k.sizing.h === 'HUG' || k.sizing.h === 'FIXED')) return 'flex-start';
  return undefined;
}

/** Rules a child needs from how it sits in its parent's auto-layout. */
function childSizing(n: SNode, parent: SNode, ctx: Ctx): Decl[] {
  const P = parent.layout;
  const out: Decl[] = [];
  if (!P) return out;
  const kids = (parent.children ?? []).filter(c => c.visible && !c.absolute);
  if (P.mode === 'HORIZONTAL') {
    const allFill = kids.length > 1 && kids.every(k => k.sizing.h === 'FILL');
    if (n.sizing.h === 'FILL') {
      if (allFill) ensureEqualColumns(parent, ctx);
      else out.push(d('flex: 1'), d('min-width: 0'));
    } else if (n.sizing.h === 'FIXED' && n.type !== 'TEXT' && n.type !== 'INSTANCE') {
      out.push(...fixedSize(n, ctx, 'width'));
    }
    if (n.sizing.v === 'FILL' && P.cross !== 'MIN') out.push(d('align-self: stretch'));
  } else {
    if (n.sizing.v === 'FILL') out.push(d('flex: 1'));
    if (n.sizing.h === 'FILL' && P.cross !== 'MIN') out.push(d('align-self: stretch'));
    if (n.sizing.h === 'FIXED' && n.type !== 'TEXT' && n.type !== 'INSTANCE') out.push(...fixedSize(n, ctx, 'width'));
    // Mixed column (some Fill, some Hug): Hug boxes opt out of the default stretch.
    const boxes = kids.filter(k => k.type !== 'TEXT');
    const mixed = boxes.some(k => k.sizing.h === 'FILL') && boxes.some(k => k.sizing.h !== 'FILL');
    if (mixed && n.type !== 'TEXT' && n.sizing.h !== 'FILL' && P.cross === 'MIN') out.push(d('align-self: flex-start'));
  }
  if (n.minWidth) out.push(d(`min-width: ${n.minWidth}px`, 'ds-allow: min width set in Figma'));
  if (n.maxWidth) out.push(d(`max-width: ${n.maxWidth}px`, 'ds-allow: max width set in Figma'));
  return dedupeDecls(out);
}

/** Row whose children all Fill: one rule on the parent instead of a class per child. */
function ensureEqualColumns(parent: SNode, ctx: Ctx) {
  const cls = [...ctx.classes].find(([, owner]) => owner === parent.id)?.[0];
  const r = cls ? ctx.rules.find(x => x.selector === `.${cls}`) : undefined;
  if (r && !r.nested.some(x => x.selector === '> *')) r.nested.push(rule('> *', [d('flex: 1'), d('min-width: 0')]));
}

function fixedSize(n: SNode, ctx: Ctx, what: string): Decl[] {
  ctx.page.fixedSizes.push(`"${n.name}" (${what} ${n.width}×${n.height})`);
  const out = [d(`width: ${n.width}px`, 'ds-allow: fixed size from Figma, no auto-layout')];
  if (what !== 'width') out.push(d(`height: ${n.height}px`, 'ds-allow: fixed size from Figma, no auto-layout'));
  return out;
}

function dedupeDecls(ds: Decl[]): Decl[] {
  const seen = new Set<string>();
  return ds.filter(x => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

// ── Local components (repeated or single) ───────────────────────────────────

function renderLocalUsage(group: SNode[], parent: SNode, ctx: Ctx): string[] {
  const inst = group[0].instance!;
  const def = ctx.page.snapshot.components[inst.name];
  if (!def) return [`<!-- Skipped "${inst.name}": component definition not in the selection -->`];
  const lc = localComponent(def, ctx.page);
  lc.usages.push(...group);
  const data = ctx.data;
  const mocks = group.map((u, i) => itemMock(lc, u, i));

  // Re-emit the component's outputs from the page.
  const events = [...lc.outputs].map(([name, type]) => `(${name})="${uniqueOutput(ctx.page, name, type)}.emit($event)"`);
  const sizing = group.length === 1 ? childSizing(group[0], parent, ctx) : [];
  if (group.length > 1 && data) {
    let field = plural(lc.input);
    let i = 2;
    while (data.fields.some(f => f.name === field)) field = `${plural(lc.input)}${i++}`;
    data.fields.push({ name: field, type: `${lc.item}[]`, mock: mocks });
    const tag = `<${lc.selector} [${lc.input}]="${lc.input}"${events.length ? ' ' + events.join(' ') : ''} />`;
    return [`@for (${lc.input} of ${ctx.dataRoot}.${field}; track ${lc.input}.id) {`, `  ${tag}`, '}'];
  }
  let field = lc.input;
  let i = 2;
  while (data?.fields.some(f => f.name === field)) field = `${lc.input}${i++}`;
  data?.fields.push({ name: field, type: lc.item, mock: mocks[0] });
  let cls = '';
  if (sizing.length) {
    const c = allocClass(ctx, kebab(group[0].name), group[0].id);
    ctx.rules.push(rule(`.${c}`, sizing));
    cls = ` class="${c}"`;
  }
  return [`<${lc.selector}${cls} [${lc.input}]="${ctx.dataRoot}.${field}"${events.length ? ' ' + events.join(' ') : ''} />`];
}

/** Build (once) the local component's item type from its definition and all its usages. */
function localComponent(def: SNode, page: PageState): LocalComp {
  const existing = page.locals.get(def.name);
  if (existing) return existing;
  const item = itemName(def.name);
  const lc: LocalComp = {
    def, item, input: camel(item), selector: `${page.config.naming.pageSelectorPrefix}-${kebab(def.name)}`,
    className: `${pascal(def.name)}Component`, file: `${kebab(def.name)}.component`,
    fields: [{ name: 'id', tsType: 'string', source: { kind: 'id' } }], enums: new Map(), nestedFields: new Map(), outputs: new Map(),
    usages: [], dsImports: new Set(), typeImports: new Set(), template: [], rules: [],
  };
  page.locals.set(def.name, lc);

  // Text properties of the component become string fields.
  walk(def, n => {
    if (n.type === 'TEXT' && n.text?.prop && !lc.fields.some(f => f.name === camel(n.text!.prop!))) {
      lc.fields.push({ name: camel(n.text.prop), tsType: 'string', source: { kind: 'text', prop: n.text.prop } });
    }
  });

  // Nested library instances whose properties differ between usages become fields too.
  const allUsages = collectUsages(page.snapshot, def.name);
  walk(def, n => {
    if (n.type !== 'INSTANCE' || !n.instance) return;
    const lib = libraryComponent(page.mapping, n.instance.key);
    if (!lib) return;
    const values = allUsages.map(u => findNested(u, n.id)?.instance).filter(Boolean) as NonNullable<SNode['instance']>[];
    if (values.length < 2) return;
    const varies = (get: (i: NonNullable<SNode['instance']>) => string | undefined) => new Set(values.map(get)).size > 1;
    const varyingVariant = Object.keys(n.instance.variant).filter(p => lib.props[p] && varies(i => i.variant[p]));
    const varyingText = Object.keys(n.instance.text).filter(p => lib.props[p] && varies(i => i.text[p]));
    if (!varyingVariant.length && !varyingText.length) return;
    const renamed = n.name !== n.instance.name && n.name !== lib.name;
    const base = camel(renamed ? n.name : lib.name);
    if (!renamed) {
      page.issues.push({ rule: 'data-names', severity: 'warn', nodeId: n.id, nodeName: n.name, message: `"${n.name}" changes per ${def.name} row, so it becomes the data field "${base}". Rename the layer (e.g. "status") to name the field.` });
    }
    // Text and variant change together (label "Active" ↔ tone "success"): one enum field.
    const keyOf = (i: NonNullable<SNode['instance']>) => kebab(varyingText.map(p => i.text[p]).join(' ') || varyingVariant.map(p => i.variant[p]).join(' '));
    const functional = values.every(a => values.every(b => keyOf(a) !== keyOf(b) || varyingVariant.every(p => a.variant[p] === b.variant[p])));
    if (varyingText.length && varyingVariant.length && functional) {
      const e: EnumDef = { field: base, typeName: `${item}${pascal(base)}`, constName: constant(base), lib, values: new Map(), varyingVariant, varyingText };
      for (const v of values) {
        const k = keyOf(v);
        if (!e.values.has(k)) e.values.set(k, { variant: pick(v.variant, varyingVariant), text: pick(v.text, varyingText) });
      }
      lc.enums.set(n.id, e);
      lc.fields.push({ name: base, tsType: e.typeName, source: { kind: 'enum', defId: n.id } });
      // The DS types (e.g. DsBadgeTone) are only needed by the component's lookup table.
    } else {
      const fs: ItemField[] = [];
      for (const p of [...varyingVariant, ...varyingText]) {
        const isVariant = varyingVariant.includes(p);
        const t = isVariant ? lib.props[p].type ?? 'string' : 'string';
        if (isVariant && lib.props[p].type) lc.typeImports.add(lib.props[p].type!);
        fs.push({ name: `${base}${pascal(p)}`, tsType: t, source: { kind: 'nested', defId: n.id, prop: p, variant: isVariant } });
      }
      lc.nestedFields.set(n.id, fs);
      lc.fields.push(...fs);
    }
  });
  renderLocalTemplate(lc, allUsages.length, page);
  return lc;
}

function itemMock(lc: LocalComp, usage: SNode, index: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of lc.fields) {
    const s = f.source;
    if (s.kind === 'id') out.id = `${kebab(lc.item)}-${index + 1}`;
    else if (s.kind === 'text') out[f.name] = usage.instance?.text[s.prop] ?? '';
    else if (s.kind === 'enum') {
      const e = lc.enums.get(s.defId)!;
      const inst = findNested(usage, s.defId)?.instance;
      out[f.name] = inst ? kebab(e.varyingText.map(p => inst.text[p]).join(' ') || e.varyingVariant.map(p => inst.variant[p]).join(' ')) : [...e.values.keys()][0];
    } else {
      const inst = findNested(usage, s.defId)?.instance;
      out[f.name] = (s.variant ? inst?.variant[s.prop] : inst?.text[s.prop]) ?? '';
    }
  }
  return out;
}

/** Render the definition into the component's template and Sass (once, before usages re-emit its outputs). */
function renderLocalTemplate(lc: LocalComp, usageCount: number, page: PageState) {
  const ctx: Ctx = {
    rules: lc.rules, classes: new Map(), dsImports: lc.dsImports, usesRouter: { value: false }, page, local: lc, dataRoot: `${lc.input}()`,
  };
  const host = rule(':host', boxDecls(lc.def, null, ctx, false));
  // A bottom-only (or top-only) 1px stroke on a repeated row is a divider: drop it on the last row.
  const w = lc.def.strokeWeights;
  if (w && usageCount > 1) {
    if (w[2] > 0 && w[0] === 0 && w[1] === 0 && w[3] === 0) host.nested.push(rule('&:last-child', [d('border-bottom: 0')]));
    if (w[0] > 0 && w[1] === 0 && w[2] === 0 && w[3] === 0) host.nested.push(rule('&:first-child', [d('border-top: 0')]));
  }
  lc.rules.push(host);
  lc.template = flatMap(renderableKids(lc.def), g => renderLocalNode(g[0], lc.def, ctx, host));
}

function renderLocalFiles(lc: LocalComp, dir: string, page: PageState): GeneratedFile[] {
  const tpl = lc.template;
  const computeds: string[] = [];
  for (const e of lc.enums.values()) {
    computeds.push(`protected readonly ${e.field} = computed(() => ${e.constName}[this.${lc.input}().${e.field}]);`);
  }
  const core = new Set(['ChangeDetectionStrategy', 'Component', 'input']);
  if (lc.outputs.size) core.add('output');
  if (computeds.length) core.add('computed');
  const dsNames = [...lc.dsImports].sort();
  const dsTypes = flatMap([...lc.enums.values()], e => e.varyingVariant.map(p => e.lib.props[p].type).filter(Boolean) as string[]);
  const dsLine = [...new Set([...dsNames, ...dsTypes])].sort();
  const modelNames = [lc.item, ...[...lc.enums.values()].map(e => e.typeName)].sort();
  const feature = dir.split('/').pop()!;
  const lines: string[] = [
    `import { ${[...core].sort().join(', ')} } from '@angular/core';`,
    ...(dsLine.length ? [`import { ${dsLine.join(', ')} } from '${page.mapping.library.import}';`] : []),
    `import { ${modelNames.join(', ')} } from './${feature}.models';`,
    '',
    `// Figma: ${page.snapshot.pageName ? page.snapshot.pageName + ' / ' : ''}${lc.def.name} (feature-level, not part of ${page.mapping.library.import})`,
  ];
  for (const e of lc.enums.values()) {
    const shape = [...e.varyingVariant.map(p => `${e.lib.props[p].input}: ${e.lib.props[p].type ?? 'string'}`), ...e.varyingText.map(p => `${p}: string`)];
    lines.push(`const ${e.constName}: Record<${e.typeName}, { ${shape.join('; ')} }> = {`);
    for (const [k, v] of e.values) {
      const obj = [...e.varyingVariant.map(p => `${e.lib.props[p].input}: ${tsString(v.variant[p])}`), ...e.varyingText.map(p => `${p}: ${tsString(v.text[p])}`)];
      lines.push(`  ${/^[a-z_$][\w$]*$/i.test(k) ? k : tsString(k)}: { ${obj.join(', ')} },`);
    }
    lines.push('};');
  }
  lines.push(
    '',
    '@Component({',
    `  selector: '${lc.selector}',`,
    '  changeDetection: ChangeDetectionStrategy.OnPush,',
    `  imports: [${dsNames.join(', ')}],`,
    '  template: `',
    ...tpl.map(l => (l ? '    ' + inTemplateLiteral(l) : '')),
    '  `,',
    `  styleUrl: './${lc.file}.scss',`,
    '})',
    `export class ${lc.className} {`,
    `  readonly ${lc.input} = input.required<${lc.item}>();`,
    ...[...lc.outputs].map(([n, t]) => `  readonly ${n} = output<${t}>();`),
    ...computeds.map(c => `  ${c}`),
    '}',
    '',
  );
  return [
    { path: `${dir}/${lc.file}.ts`, content: lines.join('\n'), mode: 'create' },
    { path: `${dir}/${lc.file}.scss`, content: writeSheet(lc.rules), mode: 'create' },
  ];
}

function renderLocalNode(n: SNode, parent: SNode, ctx: Ctx, parentRule: Rule): string[] {
  const lc = ctx.local!;
  if (n.type === 'INSTANCE' && n.instance) {
    const lib = libraryComponent(ctx.page.mapping, n.instance.key);
    if (lib) {
      const bindings: Record<string, string> = {};
      const e = lc.enums.get(n.id);
      if (e) {
        for (const p of e.varyingVariant) bindings[p] = `${e.field}().${lib.props[p].input}`;
        for (const p of e.varyingText) bindings[p] = `${e.field}().${p}`;
      }
      for (const f of lc.nestedFields.get(n.id) ?? []) {
        if (f.source.kind === 'nested') bindings[f.source.prop] = `${lc.input}().${f.name}`;
      }
      return renderLibrary(n, lib, parent, ctx, bindings);
    }
  }
  if (CONTAINERS.has(n.type) && n.type !== 'INSTANCE') {
    const { tag, cls: base } = tagFor(n.name, ctx.page.mapping);
    const cls = allocClass(ctx, base, n.id);
    const r = rule(`.${cls}`, boxDecls(n, parent, ctx, false));
    ctx.rules.push(r);
    const inner = flatMap(renderableKids(n), g => renderLocalNode(g[0], n, ctx, r));
    return [`<${tag} class="${cls}">`, ...inner.map(l => '  ' + l), `</${tag}>`];
  }
  return renderNode(n, parent, ctx, parentRule);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Visit descendants of a definition; does not descend into instances (they render themselves). */
function walk(n: SNode, fn: (n: SNode) => void) {
  for (const c of n.children ?? []) {
    if (!c.visible) continue;
    fn(c);
    if (c.type !== 'INSTANCE') walk(c, fn);
  }
}

function collectUsages(s: Snapshot, name: string): SNode[] {
  const out: SNode[] = [];
  const visit = (n: SNode) => {
    if (n.type === 'INSTANCE' && n.instance?.name === name) out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  s.frames.forEach(visit);
  return out;
}

/** The node inside a usage instance that corresponds to definition node `defId` ("I4:37;4:7" ↔ "4:7"). */
function findNested(usage: SNode, defId: string): SNode | undefined {
  let found: SNode | undefined;
  const visit = (n: SNode) => {
    if (found) return;
    if (n.id.endsWith(`;${defId}`)) found = n;
    for (const c of n.children ?? []) visit(c);
  };
  (usage.children ?? []).forEach(visit);
  return found;
}

// ES2017-only helpers: the Figma-hosted plugin build compiles against lib ES2017 (no flatMap, no fromEntries).
function flatMap<T, U>(xs: T[], fn: (x: T) => U[]): U[] {
  const out: U[] = [];
  for (const x of xs) out.push(...fn(x));
  return out;
}

function pick(o: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

function literal(v: unknown): string {
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'string' ? tsString(x) : String(x)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return typeof v === 'string' ? tsString(v) : String(v);
}

function collectGaps(page: PageState, root: SNode | undefined, mapping: Mapping): string[] {
  const gaps: string[] = [];
  if (root && root.sizing.h === 'FIXED') gaps.push(`**No layout tokens.** Page max width uses \`${root.width}px\` with a \`ds-allow\` comment.`);
  for (const lc of page.locals.values()) {
    gaps.push(`**${humanize(lc.def.name)} pattern.** \`${lc.selector}\` is feature-level. If other screens need it, promote it to \`${mapping.library.import}\`.`);
  }
  const unmapped = new Set(page.issues.filter(i => i.rule === 'mapped-components').map(i => i.message));
  for (const m of unmapped) gaps.push(`**Missing mapping.** ${m}`);
  if (page.issues.some(i => i.rule === 'library-assets')) gaps.push('**Assets.** The screen uses images or icons that are not in the library; they are not exported yet.');
  return gaps;
}

function buildPrBody(o: {
  featureTitle: string; snapshot: Snapshot; frames: SNode[]; mockNames: { state: string; route: string }[]; issues: Issue[];
  gaps: string[]; outputs: { name: string; type: string }[]; notes: string[]; config: ShipConfig; locals: LocalComp[];
}): string {
  const fileKey = o.snapshot.fileKey || o.config.figmaFileKey;
  const link = (id: string) => `https://www.figma.com/design/${fileKey}?node-id=${id.replace(':', '-')}`;
  const warns = o.issues.filter(i => i.severity === 'warn');
  const states = o.mockNames.map(m => m.state);
  const required = o.config.requiredStates ?? [];
  const lines = [
    '## What this PR delivers',
    '',
    `The ${o.featureTitle} screen, generated by Ship to Frontend from the Figma frame${o.frames.length > 1 ? 's' : ''}: built from \`@ds/ui\` with mock data for every state frame. Ready for frontend to connect to the real API.`,
    '',
    ...o.frames.map(f => `**Figma:** [${f.name}](${link(f.id)})`),
    `**Preview routes:** ${o.mockNames.map(m => `\`/${m.route}\``).join(', ')}`,
    '',
    '## Type of PR',
    '',
    '- [x] Designer UI build (`design/*` → `feature/*`): presentational only, mock data',
    '',
    '## Designer UI checklist',
    '',
    '- [x] Built only from `@ds/ui` and tokens (generated; CI runs `npm run check:ds`)',
    `- [${required.every(s => states.includes(s)) ? 'x' : ' '}] States covered: ${['default', ...required].map(s => (states.includes(s) ? s : `~~${s}~~`)).join(' · ')}`,
    `- [x] View model types in \`${kebab(o.featureTitle)}.models.ts\`, mocks in \`${kebab(o.featureTitle)}.mock.ts\``,
    '- [x] Matches the Figma frame (generated from it)',
    '',
  ];
  if (warns.length) {
    lines.push('## Readiness warnings', '');
    for (const w of warns) lines.push(`- ${w.message} ([layer](${link(w.nodeId.replace(/^I/, '').split(';')[0])}))`);
    lines.push('');
  }
  lines.push('## Design system gaps', '', ...(o.gaps.length ? o.gaps.map(g => `- ${g}`) : ['- None found.']), '');
  lines.push('## Notes for frontend', '');
  lines.push(`- Connect \`${pascal(o.featureTitle)}Vm\` to the real data; the page only needs \`vm\` as input.`);
  if (o.outputs.length) lines.push(`- Outputs to handle: ${o.outputs.map(x => `\`${x.name}${x.type === 'void' ? '' : `(${x.type})`}\``).join(', ')}.`);
  lines.push('- Preview routes in `app.routes.ts` should stay for QA, or move behind a dev-only flag.');
  for (const n of o.notes) lines.push(`- ${n}`);
  lines.push('');
  return lines.join('\n');
}
