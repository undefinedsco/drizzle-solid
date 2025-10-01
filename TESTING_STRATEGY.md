# Testing Strategy

## Suite Layout
- `tests/unit/**`: fast TypeScript unit coverage for builders, parsers, and utilities.
- `tests/integration/css/**`: end-to-end flows against a local Community Solid Server (CSS) booted via `jest.global-setup.js`.

## Execution Modes
- `npm run test` – runs the full suite (unit + CSS integration). Global setup auto-starts CSS, provisions credentials, and exposes them via env vars.
- `SOLID_ENABLE_REAL_TESTS=false npm run test` – skips CSS bootstrap, useful while iterating on pure unit logic.
- `npm run test -- --runTestsByPath tests/integration/css/drizzle-crud.test.ts` – target a single integration flow when verifying feature work.
- Run `npm run css:install` once (or after dependency bumps) to populate `.internal/css-runtime/node_modules` with CSS’s own dependency tree. The main workspace keeps Comunica v4; the isolated runtime pins the CSS-shipped v2 stack to avoid resolver conflicts.

## Integration Expectations
- CSS tests rely on seeded accounts from `config/preset-accounts.json`. Credentials are minted automatically; never commit secrets.
- Containers are created dynamically under `/drizzle-tests/<timestamp>/` to keep runs isolated, and tests clean up their own resources.
- TypeIndex scenarios create temporary registrations and remove them after assertions so the profile remains tidy.

## Development Workflow
1. Implement feature logic alongside unit coverage in `tests/unit`.
2. Extend or author CSS-backed tests exercising the new behavior end-to-end.
3. Update docs/examples to match the new flow.
4. Run `npm run test:coverage` (or at least `npm run test`) before opening a PR, attaching the command output.

## Known Gaps
- Comunica packages bundled with CSS sometimes conflict with local installs; if the CSS bootstrap fails, re-install dependencies or pin compatible versions before re-running.
- Additional coverage is still needed for advanced SPARQL flows and migration helpers; track follow-ups in `PROGRESS.md`.
