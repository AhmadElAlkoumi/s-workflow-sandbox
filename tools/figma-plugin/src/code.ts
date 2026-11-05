// Ship to Frontend: plugin main thread.
// Reads the selected frames, runs the shared generator (readiness check + Angular code)
// and hands the result to the UI. Network calls (repo context, push) happen in the UI,
// which talks only to the Ship to Frontend service.
import bundledMapping from '../../../figma/mapping.json';
import bundledConfig from '../../../.ship-to-frontend.json';
import { generate } from '../../generator/src/generate';
import { serializeFrames } from '../../generator/src/serialize';
import { splitFrameName } from '../../generator/src/names';
import type { Mapping, ShipConfig } from '../../generator/src/types';

declare const figma: any;
declare const __html__: string;

let mapping = bundledMapping as unknown as Mapping;
let config = bundledConfig as unknown as ShipConfig;
let existing: Record<string, string> = {};
let source: 'bundled' | 'repo' = 'bundled';

figma.showUI(__html__, { width: 520, height: 680, themeColors: true, title: 'Ship to Frontend' });

/** Top-level frames in the selection, plus the other state frames of the same screen. */
function selectedFrames(): any[] {
  const top = (n: any) => n.parent && (n.parent.type === 'PAGE' || n.parent.type === 'SECTION');
  const picked = figma.currentPage.selection.map((n: any) => {
    let x = n;
    while (x && !top(x)) x = x.parent;
    return x;
  }).filter((n: any) => n && n.type === 'FRAME');
  const unique = [...new Map(picked.map((n: any) => [n.id, n])).values()] as any[];
  if (!unique.length) return [];
  // "Team members / default" selected → also take "Team members / empty", "/ error", …
  const feature = splitFrameName(unique[0].name).feature;
  const siblings = (unique[0].parent.children as any[]).filter(n => n.type === 'FRAME' && splitFrameName(n.name).conventional && splitFrameName(n.name).feature === feature);
  return [...new Map([...unique, ...siblings].map(n => [n.id, n])).values()];
}

let running = false;
let again = false;
async function run() {
  if (running) { again = true; return; }
  running = true;
  try {
    const frames = selectedFrames();
    if (!frames.length) {
      figma.ui.postMessage({ type: 'empty' });
      return;
    }
    const t0 = Date.now();
    const libraryKeys = Object.values(mapping.components).map(c => c.key);
    const snapshot = await serializeFrames(frames.map(f => f.id), libraryKeys);
    const t1 = Date.now();
    const result = generate(snapshot, { mapping, config, existing });
    figma.ui.postMessage({
      type: 'result',
      result,
      meta: {
        fileKey: snapshot.fileKey || config.figmaFileKey,
        frames: snapshot.frames.map(f => ({ id: f.id, name: f.name })),
        user: snapshot.user,
        source,
        ms: { read: t1 - t0, generate: Date.now() - t1 },
        layers: countLayers(snapshot.frames),
      },
    });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
    if (again) { again = false; run(); }
  }
}

function countLayers(nodes: { children?: unknown[] }[]): number {
  let n = 0;
  const visit = (x: { children?: unknown[] }) => { n++; (x.children as { children?: unknown[] }[] | undefined)?.forEach(visit); };
  nodes.forEach(visit);
  return n;
}

figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'select') {
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (!node) return;
    // Layers inside an instance can be selected directly (ids like "I4:37;4:7").
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  } else if (msg.type === 'rerun') {
    run();
  } else if (msg.type === 'repo-context') {
    // Fresh mapping, settings and current routes/main from the repo, read by the service.
    if (msg.mapping) mapping = msg.mapping;
    if (msg.config) config = msg.config;
    existing = msg.existing ?? {};
    source = 'repo';
    run();
  } else if (msg.type === 'notify') {
    figma.notify(msg.text, { timeout: 4000 });
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};

let timer: ReturnType<typeof setTimeout> | undefined;
figma.on('selectionchange', () => {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
});

run();
