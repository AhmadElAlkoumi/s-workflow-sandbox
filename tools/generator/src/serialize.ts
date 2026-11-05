// Figma → Snapshot. Runs where the Figma Plugin API exists: in the plugin main thread
// (tools/figma-plugin/src/code.ts) and through the Figma MCP server's use_figma tool.
// Uses only async node APIs, so it works with "documentAccess": "dynamic-page".
import type { Bindable, SInstance, SNode, SPaint, Snapshot, SReaction } from './types';

// The plugin typings are not a dependency of the generator; the API surface used here is small.
declare const figma: any;
// A loosely typed scene node: the serializer reads optional mixins (auto-layout, text, instance)
// across node types. Spelled via JSON.parse's return type so the Figma-hosted build's lint
// (no explicit any) accepts it.
export type FNode = ReturnType<typeof JSON.parse>;

const cleanProp = (k: string) => k.replace(/#[^#]*$/, '');

const toHex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * @param libraryKeys component (set) keys of the mapped design-system components
 *   (from figma/mapping.json). Their instances are recorded but not descended into;
 *   every other component is a feature-local component whose definition is serialized.
 */
export async function serializeFrames(frameIds: string[], libraryKeys: string[]): Promise<Snapshot> {
  const library = new Set(libraryKeys);
  const varNames = new Map<string, { name: string; css?: string }>();
  const components: Record<string, SNode> = {};
  const pendingComponents = new Map<string, FNode>();

  async function variable(alias: { id: string } | undefined): Promise<string | undefined> {
    if (!alias || !alias.id) return undefined;
    if (!varNames.has(alias.id)) {
      const v = await figma.variables.getVariableByIdAsync(alias.id);
      const web: string | undefined = v?.codeSyntax?.WEB;
      const css = web ? web.replace(/^var\((.*)\)$/, '$1').trim() : undefined;
      varNames.set(alias.id, { name: v ? v.name : `unknown:${alias.id}`, css });
    }
    return varNames.get(alias.id)!.name;
  }

  async function bindable(n: FNode, field: string): Promise<Bindable> {
    const value = typeof n[field] === 'number' ? n[field] : 0;
    const out: Bindable = { value };
    const v = await variable(n.boundVariables?.[field]);
    if (v) out.variable = v;
    return out;
  }

  async function paints(list: unknown): Promise<SPaint[]> {
    if (!Array.isArray(list)) return [];
    const out: SPaint[] = [];
    for (const p of list) {
      if (p.visible === false) continue;
      const sp: SPaint = { type: p.type };
      const v = await variable(p.boundVariables?.color);
      if (v) sp.variable = v;
      if (p.type === 'SOLID' && p.color) sp.hex = toHex(p.color);
      out.push(sp);
    }
    return out;
  }

  async function instanceInfo(n: FNode): Promise<SInstance | undefined> {
    const mc = await n.getMainComponentAsync();
    if (!mc) return undefined;
    const owner = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : mc;
    const variant: Record<string, string> = {};
    const text: Record<string, string> = {};
    for (const [k, p] of Object.entries<FNode>(n.componentProperties || {})) {
      if (p.type === 'TEXT') text[cleanProp(k)] = String(p.value);
      else if (p.type === 'VARIANT' || p.type === 'BOOLEAN') variant[cleanProp(k)] = String(p.value);
    }
    const textDefaults: Record<string, string> = {};
    // Rule: only read componentPropertyDefinitions from a set or a non-variant component.
    try {
      for (const [k, d] of Object.entries<FNode>(owner.componentPropertyDefinitions || {})) {
        if (d.type === 'TEXT') textDefaults[cleanProp(k)] = String(d.defaultValue);
      }
    } catch { /* remote definitions may be unavailable; defaults are only used for a warning */ }
    if (!library.has(owner.key) && !pendingComponents.has(owner.name)) {
      pendingComponents.set(owner.name, owner);
    }
    return { key: owner.key, name: owner.name, mainId: owner.id, remote: !!owner.remote, variant, text, textDefaults };
  }

  async function walk(n: FNode, inComponentDef: boolean): Promise<SNode> {
    const node: SNode = {
      id: n.id,
      type: n.type,
      name: n.name,
      visible: n.visible !== false,
      width: Math.round(n.width ?? 0),
      height: Math.round(n.height ?? 0),
      sizing: { h: n.layoutSizingHorizontal ?? 'FIXED', v: n.layoutSizingVertical ?? 'FIXED' },
      absolute: n.layoutPositioning === 'ABSOLUTE',
      fills: n.type === 'INSTANCE' ? [] : await paints(n.fills),
      strokes: n.type === 'INSTANCE' ? [] : await paints(n.strokes),
      clips: !!n.clipsContent,
    };
    if (typeof n.minWidth === 'number' && n.minWidth > 0) node.minWidth = Math.round(n.minWidth);
    if (typeof n.maxWidth === 'number' && n.maxWidth > 0 && n.maxWidth < 1e5) node.maxWidth = Math.round(n.maxWidth);

    if ('layoutMode' in n) {
      node.layout = n.layoutMode === 'NONE' ? null : {
        mode: n.layoutMode,
        gap: await bindable(n, 'itemSpacing'),
        padding: [
          await bindable(n, 'paddingTop'),
          await bindable(n, 'paddingRight'),
          await bindable(n, 'paddingBottom'),
          await bindable(n, 'paddingLeft'),
        ],
        wrap: n.layoutWrap === 'WRAP',
        main: n.primaryAxisAlignItems,
        cross: n.counterAxisAlignItems,
      };
    }
    if (node.strokes.length) {
      const w = typeof n.strokeWeight === 'number' ? n.strokeWeight : 0;
      node.strokeWeights = [n.strokeTopWeight ?? w, n.strokeRightWeight ?? w, n.strokeBottomWeight ?? w, n.strokeLeftWeight ?? w];
    }
    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      const r: Bindable = { value: n.cornerRadius };
      const v = await variable(n.boundVariables?.topLeftRadius);
      if (v) r.variable = v;
      node.radius = r;
    }
    if (n.type === 'TEXT') {
      const style = n.textStyleId && typeof n.textStyleId === 'string' ? await figma.getStyleByIdAsync(n.textStyleId) : null;
      const fills = await paints(n.fills);
      node.text = {
        characters: n.characters,
        style: style ? style.name : undefined,
        fill: fills[fills.length - 1],
        truncate: n.textTruncation === 'ENDING',
        maxLines: typeof n.maxLines === 'number' ? n.maxLines : undefined,
      };
      const ref = n.componentPropertyReferences?.characters;
      if (inComponentDef && ref) node.text.prop = cleanProp(ref);
    }
    if (Array.isArray(n.reactions) && n.reactions.length) {
      const rs: SReaction[] = [];
      for (const r of n.reactions) {
        const actions = r.actions || (r.action ? [r.action] : []);
        for (const a of actions) {
          const dest = a.destinationId ? await figma.getNodeByIdAsync(a.destinationId) : null;
          rs.push({ trigger: r.trigger?.type, action: a.type === 'NODE' ? a.navigation : a.type, destinationId: a.destinationId ?? undefined, destinationName: dest?.name });
        }
      }
      if (rs.length) node.reactions = rs;
    }
    if (n.type === 'INSTANCE') {
      node.instance = await instanceInfo(n);
      // Library components render themselves; only feature-local components need their
      // subtree (nested instance overrides become data fields).
      if (node.instance && !library.has(node.instance.key)) node.children = await kids(n, inComponentDef);
      return node;
    }
    if ('children' in n) node.children = await kids(n, inComponentDef);
    return node;
  }

  async function kids(n: FNode, inDef: boolean): Promise<SNode[]> {
    const out: SNode[] = [];
    for (const c of n.children) out.push(await walk(c, inDef));
    return out;
  }

  const frames: SNode[] = [];
  for (const id of frameIds) {
    const n = await figma.getNodeByIdAsync(id);
    if (!n) throw new Error(`Node ${id} not found`);
    frames.push(await walk(n, false));
  }
  // Serialize the definitions of local components that the frames use (may cascade).
  while (pendingComponents.size) {
    const [name, def] = pendingComponents.entries().next().value as [string, FNode];
    pendingComponents.delete(name);
    if (components[name]) continue;
    components[name] = await walk(def, true);
  }

  const variables: Record<string, string> = {};
  for (const { name, css } of varNames.values()) if (css) variables[name] = css;

  const page = frames.length ? await pageOf(frameIds[0]) : undefined;
  let user: Snapshot['user'];
  try {
    // Needs "permissions": ["currentuser"] in the plugin manifest; unavailable through use_figma.
    if (figma.currentUser) user = { id: figma.currentUser.id ?? '', name: figma.currentUser.name };
  } catch { user = undefined; }
  return {
    fileKey: figma.fileKey ?? '',
    fileName: figma.root?.name,
    pageName: page,
    frames,
    components,
    variables,
    user,
  };
}

async function pageOf(id: string): Promise<string | undefined> {
  let n = await figma.getNodeByIdAsync(id);
  while (n && n.type !== 'PAGE') n = n.parent;
  return n ? n.name : undefined;
}
