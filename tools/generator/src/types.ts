// Snapshot: the plain-JSON description of Figma frames that the generator consumes.
// It is produced by serialize.ts (inside the plugin, or through use_figma) and has
// no dependency on the Figma API, so the generator also runs in Node and in CI.

export type Sizing = 'FIXED' | 'HUG' | 'FILL';
export type Align = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | 'BASELINE';

/** A number that may be bound to a variable (by variable name, e.g. "spacing/lg"). */
export interface Bindable {
  value: number;
  variable?: string;
}

export interface SPaint {
  type: string; // SOLID, IMAGE, GRADIENT_LINEAR, …
  variable?: string;
  hex?: string;
}

export interface SLayout {
  mode: 'HORIZONTAL' | 'VERTICAL';
  gap: Bindable;
  padding: [Bindable, Bindable, Bindable, Bindable]; // top, right, bottom, left
  wrap: boolean;
  main: Align;
  cross: Align;
}

export interface SInstance {
  /** Key of the component set (or of the component when it has no set). Stable across files. */
  key: string;
  /** Name of the component set (or component), e.g. "Button", "_MemberRow". */
  name: string;
  /** Node id of the main component's set/component, in its own file. */
  mainId: string;
  remote: boolean;
  /** Variant and boolean properties, by clean name (no "#id" suffix). */
  variant: Record<string, string>;
  /** Text properties, by clean name. */
  text: Record<string, string>;
  /** Default values of the text properties, by clean name. */
  textDefaults: Record<string, string>;
}

export interface SText {
  characters: string;
  style?: string;
  fill?: SPaint;
  truncate: boolean;
  maxLines?: number;
  /** In a component definition: the text property that drives this text, e.g. "name". */
  prop?: string;
}

export interface SReaction {
  trigger: string;
  action: string;
  destinationId?: string;
  /** Name of the destination frame, e.g. "Team members / empty". */
  destinationName?: string;
}

export interface SNode {
  id: string;
  type: string; // FRAME, COMPONENT, INSTANCE, TEXT, GROUP, RECTANGLE, VECTOR, …
  name: string;
  visible: boolean;
  width: number;
  height: number;
  /** Auto-layout, or null for a container without auto-layout. Absent on leaves. */
  layout?: SLayout | null;
  sizing: { h: Sizing; v: Sizing };
  absolute: boolean;
  minWidth?: number;
  maxWidth?: number;
  fills: SPaint[];
  strokes: SPaint[];
  /** Stroke weights: top, right, bottom, left. */
  strokeWeights?: [number, number, number, number];
  radius?: Bindable;
  clips: boolean;
  text?: SText;
  instance?: SInstance;
  reactions?: SReaction[];
  children?: SNode[];
}

export interface Snapshot {
  fileKey: string;
  fileName?: string;
  pageName?: string;
  /** The selected top-level frames, one per state, e.g. "Team members / default". */
  frames: SNode[];
  /** Definitions of local (non-library) components used by the frames, by component name. */
  components: Record<string, SNode>;
  /** Variable name → CSS custom property, from the WEB code syntax, e.g. "--ds-spacing-lg". */
  variables: Record<string, string>;
  /** Figma user id of the person running the plugin (used by the service, not by the generator). */
  user?: { id: string; name: string };
}

// ── Mapping (figma/mapping.json) ────────────────────────────────────────────

export interface PropMap {
  input?: string;
  content?: boolean;
  type?: string;
}

export interface ComponentMap {
  key: string;
  nodeId: string;
  selector: string;
  className: string;
  source: string;
  props: Record<string, PropMap>;
  event?: string;
  submit?: { input: string; value: string };
  model?: string;
  typeInput?: string;
  selfClosing?: boolean;
}

export interface Mapping {
  library: { fileKey: string; import: string };
  components: Record<string, ComponentMap>;
  textStyles: Record<string, { tag: string; type: string }>;
  layerNames: Record<string, string>;
}

// ── Project config (.ship-to-frontend.json) ─────────────────────────────────

export interface ShipConfig {
  figmaFileKey: string;
  projectBranch: string;
  designBranch: string;
  paths: { features: string; routes: string; main: string };
  naming: { pageSelectorPrefix: string; templates: 'inline' | 'file' };
  canvasToken?: string;
  requiredStates?: string[];
}

// ── Output ──────────────────────────────────────────────────────────────────

export type Severity = 'block' | 'warn';

export interface Issue {
  rule: string;
  severity: Severity;
  nodeId: string;
  nodeName: string;
  message: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  /** "edit" files were merged into existing repo content. */
  mode: 'create' | 'edit';
}

export interface GenerateResult {
  feature: string;
  featureTitle: string;
  states: string[];
  issues: Issue[];
  blocked: boolean;
  files: GeneratedFile[];
  gaps: string[];
  outputs: { name: string; type: string }[];
  routes: string[];
  designBranch: string;
  projectBranch: string;
  prTitle: string;
  prBody: string;
}
