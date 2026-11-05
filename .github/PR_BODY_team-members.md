## What this PR delivers

The Team members screen, built from `@ds/ui` with mock data for every state. Ready for frontend to connect to the real API.

**Figma:** https://www.figma.com/design/n7GpHuPLWNrhdqkyGQrRDX?node-id=4-11
**Preview routes:** `/team-members`, `/team-members/empty`, `/team-members/long`, `/team-members/loading`, `/team-members/error`

## Type of PR

- [x] Designer UI build (`design/*` → `feature/*`): presentational only, mock data

## Designer UI checklist

- [x] Built only from `@ds/ui` and tokens (`npm run check:ds` passes)
- [x] States covered: default · loading · empty · error · long content
- [x] View model types in `team-members.models.ts`, mocks in `team-members.mock.ts`
- [x] Layout wraps for narrow screens (stats grid, header and invite form wrap)
- [x] Matches the Figma frame

## Design system gaps

- **Card has no content slot in Figma.** Code projects content (error state "Try again" button); Figma can't show it yet.
- **No layout tokens.** Page max width uses `1200px` with a `ds-allow` comment.
- **No skeleton/loading component.** Loading state uses a Card with text for now.
- **List / row pattern.** `app-member-row` is feature-level. If other screens need rows, promote it to `ds-list-item`.

## Notes for frontend

- Connect `TeamMembersVm` to the members API; the page only needs `vm` as input.
- Outputs to handle: `inviteClicked`, `invite(email)`, `manage(member)`, `retry`.
- Invite form has no validation yet (empty input is ignored). Error state of the input is available: `state="error"` + `hint`.
- Preview routes in `app.routes.ts` should stay for QA, or move behind a dev-only flag.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Q5qWUCgJRQFFvGoJWu3MVn
