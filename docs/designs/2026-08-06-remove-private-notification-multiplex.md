# Remove Private Notification Multiplex

## Decision

drizzle-solid will remove the `xpod.notifications.v1` client and use only Solid Notifications Protocol channels. Server-specific headers or Link relations must not select a private transport.

## Rationale

The multiplex transport depended on an xPod process-local event bridge. In a split CSS/API deployment, resource events do not reliably cross that boundary, so the transport can silently miss updates. Keeping inactive code also preserves an unsupported protocol surface and misleading configuration.

## Scope

- Delete the multiplex notification client and WebSocket channel.
- Remove xPod descriptor discovery and transport selection.
- Remove multiplex-only configuration and resync callbacks.
- Keep standard `StreamingHTTPChannel2023` and `WebSocketChannel2023` discovery, fallback, reconnect, and unsubscribe behavior.
- Treat legacy xPod headers and Link relations as irrelevant metadata.

## Compatibility

This intentionally removes the private `sessionId`, `webId`, and multiplex reconnect configuration from `NotificationsClientConfig`, plus `onResyncRequired` from subscription options. Standard Solid notification APIs remain unchanged.

## Verification

- A regression test supplies the legacy xPod descriptor together with standard Solid discovery and proves the standard channel is selected.
- Existing SSE, WebSocket, reconnect, and unsubscribe tests continue to pass.
- CJS and ESM builds and lint pass without multiplex symbols in source or generated declarations.
