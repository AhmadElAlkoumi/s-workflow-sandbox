# DS Workflow Sandbox

A small, real test of the designer → frontend workflow:

> Designers build screens with AI from the shared design system, show stakeholders a live preview, and hand frontend a PR where the UI layer is already done. Frontend focuses on data, state and logic.

## What's in here

| Piece | Where | Figma counterpart |
|---|---|---|
| Tokens (single source of truth) | `tokens/tokens.json` → `npm run tokens` → `src/ds/tokens/_tokens.scss` | Variables: Primitives, Color, Spacing, Radius |
| Design system components | `src/ds/` (import as `@ds/ui`) | Components page: Button, Input, Badge, Card |
| Code Connect templates | `figma/*.figma.ts` | Dev Mode shows these Angular snippets |
| AI rulebook | `AGENTS.md` (Claude Code reads it through `CLAUDE.md`) | — |
| Guardrails | `scripts/check-ds-usage.mjs`, `.github/workflows/ci.yml` | — |
| Ship to Frontend (plugin, generator, service) | `tools/` (see `tools/README.md`), `figma/mapping.json`, `.ship-to-frontend.json` | Plugins → Ship to Frontend |

Figma file: https://www.figma.com/design/n7GpHuPLWNrhdqkyGQrRDX

## Branch model

```
main                          design system + integrated features
 └─ feature/<name>            owned by frontend; integration happens here
     └─ design/<name>         designer's AI-built UI, PR into feature/<name>
ds/<change>                   design system changes, PR into main
```

## The loop

1. **Design system parity.** Every Figma component property has an Angular input with the same name and values. Tokens come from one file.
2. **Designer builds the screen** in Figma from library components only.
3. **Designer generates the code** with an AI agent connected to the Figma MCP server, on `design/<name>`. Code Connect makes the agent emit `<ds-button>`, not divs. `AGENTS.md` sets the rules.
4. **CI checks the PR:** tokens in sync, no raw colors/px, no native buttons or inputs, DS-only imports.
5. **Stakeholders review the preview URL** (mock data, every state has a route).
6. **Frontend integrates** on `feature/<name>`: swaps mocks for real data behind the same view model types.
7. **Gaps go back to the design system** as `ds/*` PRs, then Figma and code are updated together.

## Commands

```bash
npm install
npm start               # tokens + dev server
npm run check:ds        # design-system guardrail
npm run figma:publish   # publish Code Connect (needs FIGMA_ACCESS_TOKEN)
```
