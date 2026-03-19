# drizzle-solid Documentation Index

Chinese version: [`README.zh-CN.md`](README.zh-CN.md)

## Start here

- `README.md` — project overview, scope, installation summary
- `docs/guides/installation.md` — installation, authentication, and SPARQL engine setup
- `docs/api/README.md` — task-oriented API reference
- `docs/quick-start-local.md` — local CSS / xpod development path

## Core guides

- `docs/guides/concepts.md` — the minimum Solid / Pod / IRI mental model
- `docs/guides/authentication.md` — authentication and Session usage
- `docs/guides/multi-variable-templates.md` — multi-variable templates and locator rules
- `docs/guides/migrating-from-drizzle-orm.md` — migration from SQL Drizzle thinking
- `docs/guides/data-discovery.md` — discovery and interoperability
- `docs/guides/testing.md` — testing layers, example verification, parity, and execution-path guardrails

## xpod and runtime capabilities

- `docs/xpod-features.md` — xpod capability matrix and runtime notes
- `docs/guides/css-notifications.md` — Solid Notifications details
- `docs/federated-queries.md` — federated query notes

## Decisions and internal references

- `docs/guides/decisions/README.md` — decision record index
- `docs/guides/decisions/0001-keep-exact-target-paths-exact.md` — exact-target rule
- `docs/guides/decisions/0002-require-complete-join-locator-for-multi-variable-templates.md` — join locator rule
- `ACTION-PLAN.md` — testing / parity backlog and execution log
- `PROGRESS.md` — current progress snapshot

## Historical material

- `docs/archive/` — archived notes and retired designs
- `docs/TEST-STRATEGY.md` — early testing matrix, background only
- `docs/TEST-DIMENSIONS-COMPLETE.md` — extended testing analysis, background only
- `FINAL-SUMMARY.md` — historical summary, background only

## Suggested reading order

- new users: `README.md` → `docs/guides/installation.md` → `docs/api/README.md`
- data modeling: `docs/guides/concepts.md` → `docs/guides/multi-variable-templates.md`
- xpod integration: `docs/xpod-features.md` → `docs/api/README.md`
- testing and release work: `docs/guides/testing.md` → `ACTION-PLAN.md`
