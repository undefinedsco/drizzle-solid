# OpenSpec Instructions

OpenSpec guidance is deprecated in this repository. Do not use or reference `openspec/` workflows or files.

# Repository Guidelines

## Project Structure & Module Organization
- Core TypeScript lives in `src/` (`core/` for Solid dialect internals, `utils/` for RDF helpers, `driver/solid/` entrypoints in `index.ts`).
- Tests live in `tests/unit` and `tests/integration/css`; delete ad-hoc scripts once their flows are represented by the primary suites.
- Keep only canonical walkthroughs in `examples/` (`01-server-setup.ts`, `02-authentication.ts`, `03-basic-usage.ts`); archive experimental scripts under `examples/archive/` during cleanup.
- Authoritative docs should land in `docs/guides/` or `docs/api/`; investigative notes move to `docs/archive/` so README and `docs/quick-start-local.md` stay the single source.

## Build, Test, and Development Commands
- `yarn dev` runs `src/index.ts` through `ts-node` for quick SPARQL inspection.
- `yarn build` invokes the TypeScript compiler (CJS + ESM).
- `yarn test` executes the full vitest suite; `yarn quality` wraps lint + tests and should pass before pushing (expect CSS to start automatically after `yarn css:install`).
- `yarn lint`/`yarn lint:fix` enforce the shared `@typescript-eslint` ruleset; run `yarn server:setup` once per machine and `yarn server:start` in parallel terminals before any CSS-backed tests or demos.

## Coding Style & Naming Conventions
- Use 2-space indentation, `strict` TypeScript, and named exports that mirror Drizzle ORM (`db.select().from(table)`).
- Prefer `camelCase` functions/variables, `PascalCase` types/classes, and reserve `SCREAMING_SNAKE_CASE` for reusable constant maps (`src/core/rdf-constants.ts`).
- Shared helpers belong in `src/utils/`; avoid importing from `dist/` or reaching across layers without a public export.

## Testing Guidelines
- New coverage must hit real Community Solid Server flows—no network mocks for CRUD, TypeIndex, or SPARQL behaviors.
- Place fast logic tests in `tests/unit`; write Pod-facing journeys in `tests/integration/css` and gate them with the existing CSS manager (`jest.global-setup.js`).
- Populate `SOLID_CLIENT_ID`, `SOLID_CLIENT_SECRET`, and `SOLID_OIDC_ISSUER` in `.env.local` (never commit secrets); document extra envs in PRs.
- Install the isolated CSS runtime with `yarn css:install` whenever dependencies change so Comunica v2 (CSS) stays separate from the library's v4 stack.
- **Examples must be tested**: All example code in `examples/` must compile successfully and be verified to work. When adding or modifying examples, ensure they pass compilation checks and test their functionality against real CSS flows when possible.

## Git Operations & Commit Guidelines

### File Safety Rules
- **NEVER commit files containing secrets, tokens, or credentials**
  - Check files like `*.sh`, `*.env`, config files before staging
  - Use `git add <specific-files>` instead of `git add .` or `git add -A`
  - If unsure, show file content to user before committing
  - Common sensitive files: `.env`, `.env.local`, `*-secret.json`, `*-token.txt`, shell scripts with exports

### Commit Workflow
1. **Stage files explicitly**: `git add src/file1.ts src/file2.ts tests/file.test.ts`
2. **Review staged changes**: `git diff --cached` before committing
3. **Write Conventional Commits**:
   - `feat(core): add multi-variable subjectTemplate support`
   - `fix(utils): handle edge case in RDF parsing`
   - `docs(guides): update authentication examples`
   - `test: add unit tests for resource resolver`
   - `chore: update dependencies`
4. **Verify before push**: Run `yarn quality` (lint + test) locally first
5. **Push carefully**: Use `git push origin main` (never force push to main unless explicitly needed)

### Development Sequence
- Implement feature → add tests (unit + integration) → update docs/examples → verify with `yarn quality` → commit → push

### Pull Request Guidelines
- Include problem statement and solution approach
- Provide test evidence (unit test results + manual CSS verification if applicable)
- Document API changes and migration notes
- Keep commits focused (one logical change per commit)
- Avoid mixing refactors with feature work

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
