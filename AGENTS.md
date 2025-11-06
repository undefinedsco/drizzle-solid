<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Repository Guidelines

## Project Structure & Module Organization
- Core TypeScript lives in `src/` (`core/` for Solid dialect internals, `utils/` for RDF helpers, `driver/solid/` entrypoints in `index.ts`).
- Tests live in `tests/unit` and `tests/integration/css`; delete ad-hoc scripts once their flows are represented by the primary suites.
- Keep only canonical walkthroughs in `examples/` (`01-server-setup.ts`, `02-authentication.ts`, `03-basic-usage.ts`); archive experimental scripts under `examples/archive/` during cleanup.
- Authoritative docs should land in `docs/guides/` or `docs/api/`; investigative notes move to `docs/archive/` so README and `docs/quick-start-local.md` stay the single source.

## Build, Test, and Development Commands
- `npm run dev` runs `src/index.ts` through `ts-node` for quick SPARQL inspection.
- `npm run build`, `npm run build:browser`, and `npm run build:all` invoke the TypeScript compiler and the browser bundler (rollup scripts).
- `npm run test` executes the full Jest suite; `npm run quality` wraps lint + tests and should pass before pushing (expect CSS to start automatically after `npm run css:install`).
- `npm run lint`/`npm run lint:fix` enforce the shared `@typescript-eslint` ruleset; run `npm run server:setup` once per machine and `npm run server:start` in parallel terminals before any CSS-backed tests or demos.

## Coding Style & Naming Conventions
- Use 2-space indentation, `strict` TypeScript, and named exports that mirror Drizzle ORM (`db.select().from(table)`).
- Prefer `camelCase` functions/variables, `PascalCase` types/classes, and reserve `SCREAMING_SNAKE_CASE` for reusable constant maps (`src/core/rdf-constants.ts`).
- Shared helpers belong in `src/utils/`; avoid importing from `dist/` or reaching across layers without a public export.

## Testing Guidelines
- New coverage must hit real Community Solid Server flows—no network mocks for CRUD, TypeIndex, or SPARQL behaviors.
- Place fast logic tests in `tests/unit`; write Pod-facing journeys in `tests/integration/css` and gate them with the existing CSS manager (`jest.global-setup.js`).
- Populate `SOLID_CLIENT_ID`, `SOLID_CLIENT_SECRET`, and `SOLID_OIDC_ISSUER` in `.env.local` (never commit secrets); document extra envs in PRs.
- Install the isolated CSS runtime with `npm run css:install` whenever dependencies change so Comunica v2 (CSS) stays separate from the library’s v4 stack.

## Commit & Pull Request Guidelines
- Follow the sequence: implement feature → add CSS-backed integration + targeted unit tests → refresh docs/examples → verify with `npm run quality` (or capture why integration tests were skipped).
- Write Conventional Commits (`feat(core):`, `fix(utils):`, `docs(guides):`) and keep unrelated refactors out of scope.
- PRs must include a short problem statement, test evidence (including manual CSS steps), migration notes if API changes, and reviewers for each touched area.

## Current Cleanup Priorities
- Collapse redundant docs into `README.md` + `docs/guides/`, then archive legacy notes.
- Remove obsolete example/test files once their functionality is recreated in the curated suites.
- Track remaining debt in `PROGRESS.md` and align chores with the broader Drizzle parity goal.

## Drizzle Parity & Migration Expectations
- Treat this adapter as a drop-in dialect: keep method names, query builders, and error shapes aligned with upstream Drizzle.
- Provide migration-friendly examples that mirror Drizzle’s SQL docs, calling out only the Solid-specific pieces (session bootstrap, container paths).
- Any breaking deviation from Drizzle conventions must ship with aliases or upgrade notes to preserve low migration cost.

## SQL 支持范围
- 目标与上游 Drizzle ORM 的 SQL 构建器表面保持一致，新增能力请优先对齐 Drizzle 的 API 命名和语义。
- 实际落地范围、缺口与临时代替方案需在 README/文档中明确标注，便于用户了解当前版本行为。
