# Remove Private Notification Multiplex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unsupported `xpod.notifications.v1` transport while preserving standard Solid SSE and WebSocket notification behavior.

**Architecture:** `NotificationsClient` remains the sole discovery and channel-selection owner. Discovery ignores provider-specific metadata and selects only `StreamingHTTPChannel2023` or `WebSocketChannel2023`; application-level subscription sharing remains outside this package.

**Tech Stack:** TypeScript, Vitest, Solid Notifications Protocol, Yarn.

---

### Task 1: Lock Standard Discovery Behavior

**Files:**
- Modify: `tests/unit/core/notifications/notifications-client.test.ts`
- Delete: `tests/unit/core/notifications/multiplex-notifications-client.test.ts`

- [x] Add a regression test whose HEAD response includes a legacy `X-Xpod-Notifications` header plus standard Solid notification links and assert the standard channel is used without ticket or private WebSocket requests.
- [x] Run `yarn vitest --run tests/unit/core/notifications/notifications-client.test.ts` and verify the new assertion fails while private descriptor selection remains present.

### Task 2: Remove Private Transport

**Files:**
- Modify: `src/core/notifications/notifications-client.ts`
- Modify: `src/core/notifications/types.ts`
- Delete: `src/core/notifications/multiplex-notifications-client.ts`
- Delete: `src/core/notifications/channels/multiplex-websocket-channel.ts`

- [x] Remove private imports, descriptor parsing, caches, configuration, selection, close handling, and resync callback types.
- [x] Keep standard Link-header discovery, storage-description discovery, fallback endpoints, reconnect, and unsubscribe behavior unchanged.
- [x] Run the notification unit suite and confirm it passes.

### Task 3: Verify And Commit

**Files:**
- Verify all files above.

- [x] Run `rg -n "xpod.notifications|Multiplex|multiplex" src` and expect no matches; retain legacy metadata only in the regression test.
- [x] Run `yarn build`, `yarn lint`, and `yarn vitest --run tests/unit/core/notifications`.
- [x] Review `git diff --check` and commit only the notification implementation, tests, and this plan.
