# Ship to Frontend

Turns a Figma screen built from `@ds/ui` components into the Angular presentational layer
and opens a pull request on `design/<feature>`. Spec: "Ship to Frontend: Figma Plugin Spec".

This is the **MVP core**: readiness check, deterministic generator, code preview and push.
Live prototype, share links, comment relay and the AI behavior adapter come next.

```
tools/
  generator/     shared, deterministic generator (no dependencies, runs in Figma, Node and CI)
  figma-plugin/  the Figma plugin: manifest.json, src/code.ts, src/ui.html
  service/       the small service behind the plugin (GitHub tokens, repo context, push)
figma/mapping.json        Figma component/text-style → Angular mapping (code is the source of truth)
.ship-to-frontend.json    project settings: branches, paths, naming, required states
```

## How it works

1. **Read.** `generator/src/serialize.ts` walks the selected frames with the Plugin API and
   writes a plain JSON *snapshot*: auto-layout, sizing, bound variables (with their WEB code
   syntax), text styles, component keys and properties. It is the only Figma-side code.
2. **Check.** `readiness.ts` applies the spec's rules. Blocks: detached or unmapped
   components, unbound fills/strokes/gaps/padding/radii, text without a style. Warns:
   no auto-layout, default text, missing state frames, frame names, local images.
3. **Generate.** `generate.ts` turns the snapshot into files. Same input, same output: no AI,
   no clock, no randomness.
4. **Push.** The plugin UI posts the files to the service, which commits them in one commit
   to `design/<feature>` and opens or updates the PR into the project branch.

### Generator rules (Figma → Angular)

| Figma | Generated |
|---|---|
| Library instance (matched by component-set key in `figma/mapping.json`) | `<ds-button variant="…" size="…">label</ds-button>`, attributes in mapping order |
| Auto-layout vertical / horizontal | `display: flex` (+ `flex-direction: column`) |
| Gap / padding / fill / stroke / radius bound to a variable | `var(--ds-…)` from the variable's WEB code syntax |
| Child set to Fill in a row | `flex: 1; min-width: 0` (all children Fill → one `> *` rule on the row) |
| Wrap on | `flex-wrap: wrap` |
| Fixed-width page frame | `max-width: …px` with `ds-allow`, reported as a layout-token gap |
| Text style | tag + `@include ds-type(…)` from `mapping.textStyles` (`heading/lg` → `h1`) |
| Truncate text | ellipsis (or line clamp) |
| Layer named `header`, `nav`, `section`, `…-form`, `…-list` | `<header>`, `<nav>`, `<form class="…">`, `<section class="…" aria-label="…">` |
| Form with an Input and a Button | `(submit)` handler, `[(value)]` signal, last button `type="submit"`, output with the value |
| Button | output named from its label, e.g. "Invite member" → `inviteMember` |
| Local component used repeatedly (`_MemberRow` × 4) | child component `app-member-row`, `@for` over a typed array, item type `Member` |
| Its text properties | string fields (`name`, `email`) |
| A nested instance whose variant and label change together per row | enum field + lookup table (`'active'` → `{ tone: 'success', label: 'Active' }`) |
| Frames `Team members / default`, `/ empty`, `/ error` | discriminated-union view model, `@switch`, one mock and one preview route per state; shared leading sections stay outside the switch |
| Prototype link to another frame | `routerLink` to that frame's preview route |
| Routes | `app.routes.ts` is merged, not replaced; re-shipping is idempotent. `main.ts` gets `withComponentInputBinding()` once |

## Validation (Team members, node 4:11)

`npm run generator:test` runs against the real snapshot captured from Figma
(`generator/test/fixtures/team-members.snapshot.json`):

- **Golden output** in `generator/test/expected/` — any change to generated code is a visible diff.
- **Guardrail**: generated code passes `npm run check:ds`.
- **Re-ship** is idempotent; **multi-state** frames produce a union, `@switch`, mocks and routes.
- **Same output inside Figma**: the bundled plugin code was run on 4:11 through the Figma MCP
  server; all 7 files hash identically to the Node output. Read + generate: ~190 ms for 71 layers.
- **Against PR #1** (hand-made reference, `generator/test/reference/pr-1`):

  | | Kept unchanged | Coverage of PR #1 |
  |---|---|---|
  | Figma file as it is | **75%** (114 / 152 lines) | 48% |
  | With 3 Figma fixes (rename Badge layer → `status`, wrap header and invite form, truncate email) | 80% | 53% |

  The rest is not in the Figma file: PR #1's loading / error / empty / long states (no frames
  exist for them), data bindings for the stats and workspace name, a stats grid, and a
  centered invite form where Figma says bottom-aligned. The generator follows the frame.

CI also generates the screen into a clean checkout and runs `ng build`, so strict-template
compile errors in generated code fail the PR (job `generated-code-compiles`).

## Run it

```bash
npm install
npm run check:mapping        # mapping names real Angular inputs
npm run generator:test       # golden + PR #1 comparison + guardrail + states
npm run plugin:build         # → tools/figma-plugin/dist
npm run service:test         # service against an in-memory GitHub
node tools/generator/dist/cli.js <snapshot.json> [--out dir] [--check]   # generate from a snapshot
```

### Load the plugin in Figma (development)

1. `SHIP_SERVICE_URL=http://localhost:8787 npm run plugin:build` (or no variable for check + preview only).
2. Figma desktop → Plugins → Development → Import plugin from manifest → `tools/figma-plugin/manifest.json`.
3. Select `Screens / Team members / default` and run **Ship to Frontend**. Other state frames
   of the same screen on the page are picked up automatically.

For the private org release, replace `"id"` in `manifest.json` with the id Figma assigns and
put the real service domain in `networkAccess.allowedDomains`.

### Run the service (pilot)

Tokens live only on the service. Each designer creates a fine-grained GitHub token scoped
to this repo (Contents: read and write, Pull requests: read and write) and the service owner
adds it to a file on the service host:

```jsonc
// tokens.json — chmod 600, never committed, never pasted into chat
{ "<figma user id>": { "token": "github_pat_…", "name": "Designer name" } }
```

```bash
SHIP_REPO=AhmadElAlkoumi/s-workflow-sandbox SHIP_TOKENS_FILE=/secure/tokens.json npm run service:start
```

The service only commits to `design/<feature>`, never to `main` or the project branch, never
forces, writes only inside the feature folder plus the routes and `main.ts` files, and refuses
if the project branch (`feature/<feature>`) does not exist yet.

## Known limits

- **Pilot identity.** The service maps the Figma user id sent by the plugin to a token. Anyone
  who can call the service could send another id; the rules above limit what that can do.
  The GitHub App planned after the pilot replaces this with real sign-in.
- **Not generated yet:** images and icons (warned), data bindings for single static texts
  (they stay literal), responsive breakpoints from multiple frames (v2).
- **`*.behavior.ts`** is not written: that is the AI adapter's job, next phase.
