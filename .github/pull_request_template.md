## What this PR delivers

<!-- One or two lines. -->

**Figma:** <!-- link to the frame -->
**Preview:** <!-- preview deploy URL -->

## Type of PR

- [ ] Designer UI build (`design/*` → `feature/*`): presentational only, mock data
- [ ] Integration (`feature/*` → `main`): data, state, APIs
- [ ] Design system change (`ds/*` → `main`)

## Designer UI checklist

- [ ] Built only from `@ds/ui` and tokens (`npm run check:ds` passes)
- [ ] States covered: default · loading · empty · error · long content
- [ ] View model types in `*.models.ts`, mocks in `*.mock.ts`
- [ ] Works at 360px and 1440px
- [ ] Matches the Figma frame

## Design system gaps

<!-- Anything you needed that @ds/ui doesn't have. Don't build one-offs; list them here. -->

## Notes for frontend

<!-- Assumptions about the data shape, interactions that need real logic, etc. -->
