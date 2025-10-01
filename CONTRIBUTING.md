# Contributing

Thanks for investing in drizzle-solid. This project targets Drizzle ORM users who want to move workloads onto Solid Pods, so every change should keep the migration path smooth.

## Workflow
1. **Plan first** – write down the desired behaviour and update tracking docs (e.g. `PROGRESS.md` or GitHub issues) before touching code.
2. **Implement carefully** – keep modules small, prefer the existing public API, and avoid leaking internal paths outside `src/`.
3. **Verify** – run `npm run quality` (lint + tests). If you only need unit coverage during iteration, use `SOLID_ENABLE_REAL_TESTS=false npm test` and always finish with the full suite.
4. **Document** – refresh `README`, `docs/guides/`, or `examples/` so Drizzle users can understand the new behaviour.

## Integration Tests
- Jest boots a local Community Solid Server automatically; the setup logic mints client credentials and exposes them via env vars.
- Before running CSS-backed suites, populate the isolated server runtime with `npm run css:install` so Comunica v2 dependencies live under `.internal/css-runtime` and stay separate from the library’s v4 toolchain.
- Integration specs live under `tests/integration/css`. Use the helper utilities in `tests/integration/css/helpers.ts` to create sessions, ensure containers, and clean up.
- Prefer idempotent tests that operate on timestamped containers (`/drizzle-tests/<timestamp>/`) so suites can run in parallel.

## Pull Requests
- Squash logical work into focused commits following Conventional Commits (`feat(core): …`, `fix(utils): …`, `docs(guides): …`).
- Include in the PR body: summary, testing evidence (`npm run quality` output or logs), manual steps (e.g. `npm run server:start`), and migration notes if public APIs change.
- Request reviewers for each touched area (`core`, `utils`, `examples`, `docs`).

Questions? Open an issue or start a discussion—clarifying intent before coding saves everyone time.
