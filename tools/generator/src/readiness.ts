// Readiness check: the rules from the spec, applied to a snapshot. Every issue carries
// the layer id so the plugin can select it. Only "block" issues stop a ship.
import { splitFrameName } from './names';
import type { Issue, Mapping, ShipConfig, SNode, Snapshot } from './types';

const CONTAINER_TYPES = new Set(['FRAME', 'COMPONENT', 'GROUP', 'SECTION']);
const IMAGE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE']);

export function libraryComponent(mapping: Mapping, key: string | undefined) {
  if (!key) return undefined;
  for (const [name, c] of Object.entries(mapping.components)) if (c.key === key) return { name, ...c };
  return undefined;
}

export function checkReadiness(snapshot: Snapshot, mapping: Mapping, config: ShipConfig): Issue[] {
  const issues: Issue[] = [];
  const add = (n: SNode, severity: Issue['severity'], rule: string, message: string) =>
    issues.push({ rule, severity, nodeId: n.id, nodeName: n.name, message });
  const mappedNames = new Set(Object.keys(mapping.components));

  function checkBox(n: SNode) {
    for (const p of n.fills) {
      if (p.type === 'IMAGE') add(n, 'warn', 'library-assets', `"${n.name}" has an image fill. Images are not exported yet; add it as an asset in the PR.`);
      else if (!p.variable) add(n, 'block', 'bound-values', `Fill ${p.hex ?? p.type} on "${n.name}" is not bound to a color variable.`);
    }
    for (const p of n.strokes) if (!p.variable) add(n, 'block', 'bound-values', `Stroke ${p.hex ?? p.type} on "${n.name}" is not bound to a color variable.`);
    if (n.strokes.length && n.strokeWeights && n.strokeWeights.some(w => w > 1)) {
      add(n, 'block', 'bound-values', `"${n.name}" has a ${Math.max(...n.strokeWeights)}px stroke. Only 1px borders are allowed.`);
    }
    if (n.radius && !n.radius.variable) add(n, 'block', 'bound-values', `Corner radius ${n.radius.value} on "${n.name}" is not bound to a radius variable.`);
    if (n.layout) {
      const { gap, padding, main } = n.layout;
      const kids = (n.children ?? []).filter(c => c.visible && !c.absolute).length;
      if (gap.value > 0 && !gap.variable && main !== 'SPACE_BETWEEN' && kids > 1) add(n, 'block', 'bound-values', `Gap ${gap.value} on "${n.name}" is not bound to a spacing variable.`);
      const sides = ['top', 'right', 'bottom', 'left'];
      padding.forEach((p, i) => {
        if (p.value > 0 && !p.variable) add(n, 'block', 'bound-values', `Padding ${sides[i]} ${p.value} on "${n.name}" is not bound to a spacing variable.`);
      });
    }
  }

  function visit(n: SNode, insideLocalInstance: boolean) {
    if (!n.visible) return;
    if (n.type === 'INSTANCE') {
      const lib = libraryComponent(mapping, n.instance?.key);
      if (!n.instance) {
        add(n, 'block', 'library-instances', `"${n.name}" lost its main component. Re-insert it from the library.`);
        return;
      }
      if (lib) {
        for (const prop of [...Object.keys(n.instance.variant), ...Object.keys(n.instance.text)]) {
          if (!lib.props[prop]) add(n, 'block', 'mapped-components', `${lib.name} property "${prop}" has no Angular input in figma/mapping.json.`);
        }
        for (const [prop, value] of Object.entries(n.instance.text)) {
          if (n.instance.textDefaults[prop] !== undefined && value === n.instance.textDefaults[prop]) {
            add(n, 'warn', 'default-text', `${lib.name} "${prop}" still has its default text "${value}".`);
          }
        }
        return; // library components render themselves
      }
      if (n.instance.remote) {
        add(n, 'block', 'mapped-components', `"${n.instance.name}" comes from another library and has no mapping in figma/mapping.json.`);
        return;
      }
      // Local feature component: its definition is checked once (below); here only the overrides matter.
      for (const [prop, value] of Object.entries(n.instance.text)) {
        if (n.instance.textDefaults[prop] !== undefined && value === n.instance.textDefaults[prop]) {
          add(n, 'warn', 'default-text', `${n.instance.name} "${prop}" still has its default text "${value}".`);
        }
      }
      for (const c of n.children ?? []) visitOverrides(c);
      return;
    }
    if (CONTAINER_TYPES.has(n.type) && mappedNames.has(n.name)) {
      add(n, 'block', 'library-instances', `"${n.name}" looks like a detached ${n.name}. Use the library instance.`);
    }
    if (n.type === 'TEXT') {
      if (!n.text?.style) add(n, 'block', 'text-styles', `Text "${short(n.text?.characters)}" does not use a text style.`);
      else if (!mapping.textStyles[n.text.style]) add(n, 'block', 'text-styles', `Text style "${n.text.style}" has no mapping in figma/mapping.json.`);
      if (n.text?.fill && !n.text.fill.variable) add(n, 'block', 'bound-values', `Text color ${n.text.fill.hex} on "${short(n.text.characters)}" is not bound to a color variable.`);
      return;
    }
    if (n.type === 'RECTANGLE') {
      checkBox(n);
      return;
    }
    if (IMAGE_TYPES.has(n.type)) {
      add(n, 'warn', 'library-assets', `"${n.name}" is a ${n.type.toLowerCase()} drawn in the file, not a library icon. It is skipped in the code.`);
      return;
    }
    if (CONTAINER_TYPES.has(n.type)) {
      if (n.type === 'GROUP' || n.layout === null) {
        add(n, 'warn', 'auto-layout', `"${n.name}" does not use auto-layout. It is generated with fixed sizes and flagged for frontend.`);
      }
      if (n.type !== 'GROUP') checkBox(n);
      for (const c of n.children ?? []) visit(c, insideLocalInstance);
    }
  }

  // Inside a local component instance only the override values matter (text and nested
  // library instances); its structure is checked on the definition.
  function visitOverrides(n: SNode) {
    if (n.type === 'INSTANCE' && n.instance) {
      const lib = libraryComponent(mapping, n.instance.key);
      if (lib) for (const [prop, value] of Object.entries(n.instance.text)) {
        if (n.instance.textDefaults[prop] !== undefined && value === n.instance.textDefaults[prop]) {
          add(n, 'warn', 'default-text', `${lib.name} "${prop}" still has its default text "${value}".`);
        }
      }
      return;
    }
    for (const c of n.children ?? []) visitOverrides(c);
  }

  for (const f of snapshot.frames) {
    const { conventional } = splitFrameName(f.name);
    if (!conventional) add(f, 'warn', 'frame-name', `Frame "${f.name}" does not follow "Feature / state" (e.g. "Team members / default").`);
    checkBox(f);
    if (f.layout === null) add(f, 'warn', 'auto-layout', `"${f.name}" does not use auto-layout. It is generated with fixed sizes and flagged for frontend.`);
    for (const c of f.children ?? []) visit(c, false);
  }
  // Local component definitions: checked like frames, but default text in them is expected.
  for (const def of Object.values(snapshot.components)) {
    checkBox(def);
    if (def.layout === null) add(def, 'warn', 'auto-layout', `Component "${def.name}" does not use auto-layout.`);
    for (const c of def.children ?? []) visitDef(c);
  }
  function visitDef(n: SNode) {
    if (!n.visible) return;
    if (n.type === 'INSTANCE') {
      if (!libraryComponent(mapping, n.instance?.key) && n.instance?.remote) {
        add(n, 'block', 'mapped-components', `"${n.instance.name}" comes from another library and has no mapping in figma/mapping.json.`);
      }
      return;
    }
    if (n.type === 'TEXT') return visit(n, true);
    if (CONTAINER_TYPES.has(n.type)) {
      if (n.layout === null || n.type === 'GROUP') add(n, 'warn', 'auto-layout', `"${n.name}" does not use auto-layout.`);
      if (n.type !== 'GROUP') checkBox(n);
      for (const c of n.children ?? []) visitDef(c);
    } else visit(n, true);
  }

  // States: every screen should have the required state frames.
  const byFeature = new Map<string, { states: Set<string>; frame: SNode }>();
  for (const f of snapshot.frames) {
    const { feature, state } = splitFrameName(f.name);
    const e = byFeature.get(feature) ?? { states: new Set<string>(), frame: f };
    e.states.add(state);
    byFeature.set(feature, e);
  }
  for (const [feature, { states, frame }] of byFeature) {
    const missing = (config.requiredStates ?? []).filter(s => !states.has(s));
    if (missing.length) add(frame, 'warn', 'states', `"${feature}" has no ${missing.map(s => `"${feature} / ${s}"`).join(', ')} frame. Frontend will need to design these states.`);
  }
  if (byFeature.size > 1) {
    add(snapshot.frames[0], 'block', 'one-feature', `The selection mixes screens (${[...byFeature.keys()].join(', ')}). Ship one screen and its states at a time.`);
  }

  return dedupe(issues);
}

const short = (s?: string) => (s && s.length > 40 ? s.slice(0, 37) + '…' : s ?? '');

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter(i => {
    const k = `${i.nodeId}|${i.rule}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
