# 0003 — HTTP + WebSocket on loopback, OpenAPI generated from zod

**Status:** Accepted (5 September 2026)
**Requirements:** FR-UI-012, FR-UI-009/010/011, FR-PLG-006

## Context

One core service serves several clients (web, TUI, VS Code) with required
feature parity. Clients must never write business truth except by appending
events through the core API.

## Decision

Fastify serving REST for CRUD and queries, WebSocket for the event stream, PTY
byte streams, and live scope verdicts. Loopback bind by default; any wider bind
is an explicit, warned setting that writes a config event (FR-UI-012). The auth
token lives in the OS keychain and is handed to clients at launch.

`zod` schemas are the single source of truth. OpenAPI, the JSON Schema event
appendix, the generated API client, and both plugin SDKs all derive from them.

## Consequences

- Schema drift between core, clients, and SDKs becomes structurally impossible
  rather than a review responsibility.
- The parity conformance suite has a contract to test all clients against.
- Loopback-by-default means the remote case (ADR 0005) is a deliberate,
  visible act rather than a default posture.

## Alternatives rejected

**gRPC.** Better streaming ergonomics, but a browser client then needs a proxy,
and the plugin SDK story in two languages gets heavier for no gain at this scale.

**Hand-written OpenAPI.** Guaranteed to drift from the implementation. The whole
point is that the contract cannot lie.
