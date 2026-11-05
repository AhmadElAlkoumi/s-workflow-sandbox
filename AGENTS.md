# AI rulebook: designer UI builds

Any AI agent generating UI in this repo (Claude Code, Cursor, Figma Make, Copilot) follows these rules.
CI (`npm run check:ds`) enforces most of them. A PR that breaks them is rejected automatically.

## 1. What a designer PR contains

A designer PR delivers the **presentational layer** of a feature:

- Pages and sections under `src/app/features/<feature>/`
- Every state of every screen: default, loading, empty, error, long content
- A typed view model in `<feature>.models.ts` describing the data each screen needs
- Mock data in `<feature>.mock.ts` matching those types
- A route in `src/app/app.routes.ts` so the preview URL can open the screen

A designer PR does **not** contain: HTTP calls, services, stores, auth, routing guards, business rules, or analytics.
Those are added by frontend in the integration step.

## 2. Build only from the design system

- Import UI only from `@ds/ui`. Never deep-import from `src/ds/`.
- Use `<ds-button>`, `<ds-input>`, `<ds-badge>`, `<ds-card>`. Never use native `<button>` or `<input>`.
- Use tokens for every visual value:
  - Color: `var(--ds-color-*)`
  - Spacing: `var(--ds-spacing-*)`
  - Radius: `var(--ds-radius-*)`
  - Type: `@include ds-type(body-md)` (sizes: body-sm, body-md, label-md, heading-md, heading-lg)
- No raw hex, rgb(), hsl() or px values (0 and 1px borders are fine).
- If something you need does not exist in `@ds/ui`, **do not build a one-off**. Stop and write it in the PR under "Design system gaps".

## 3. Match Figma exactly by name

Figma component properties and Angular inputs share the same names and values:

| Figma | Angular |
|---|---|
| Button `variant` primary / secondary / ghost, `size` sm / md, text `label` | `<ds-button variant size>label</ds-button>` |
| Input `state` default / error, text `label`, `placeholder`, `hint` | `<ds-input label placeholder hint state>` |
| Badge `tone` neutral / brand / success / danger, text `label` | `<ds-badge tone>label</ds-badge>` |
| Card text `title`, `description` | `<ds-card title description>…</ds-card>` |

When reading a Figma frame through the Figma MCP server, use the Code Connect snippets it returns. Do not re-create components from their visual layers.

## 4. Component shape

- Standalone components, `ChangeDetectionStrategy.OnPush`, signal `input()`s.
- Page components take their data through inputs typed by the view model, with mock data wired in the route for preview.
- Layout uses flex/grid with token gaps. No absolute positioning for layout.
- Responsive: must work from 360px to 1440px.
- Accessible: real headings in order, labels on every input, visible focus.

## 5. Branches and PRs

- Branch from the feature branch: `design/<feature>` → PR into `feature/<feature>`.
- Fill the PR template, including the Figma link and the states checklist.
- Never push to `main`.
