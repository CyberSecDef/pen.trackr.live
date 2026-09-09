# M2 core behavior contract

**Version:** 2 — M2.1 review corrections, 9 September 2026
**Implementation status:** Contract only; M2.2–M2.14 implement and test it.

This implementation reference supplements the frozen SRS and [plan](../plan.md).
Architectural decisions live in ADRs; SRS exceptions live in the plan's deltas.

## Storage and identity

The core resolves paths. Data-directory precedence is `--data-dir`,
`PENTRACKR_DATA_DIR`, then:

| Platform | Default |
|---|---|
| Linux | `$XDG_DATA_HOME/pentrackr`, otherwise `$HOME/.local/share/pentrackr` |
| macOS | `$HOME/Library/Application Support/PenTrackr` |
| Windows | `%LOCALAPPDATA%/PenTrackr` |

Overrides must be absolute; invalid bases fail startup. The directory holds
`core.toml`, `registry.db`, optional `auth.enc`, private discovery, and ownership
metadata. Configuration/discovery exclude secrets. New projects default to
`<data-dir>/projects`; `--projects-dir` or `PENTRACKR_PROJECTS_DIR` overrides the
configured root. Existing registrations retain their paths. Authentication
explicitly selects `keychain` or `passphrase` (ADR 0015).

Headless core and CLI unlock `auth.enc` through a hidden terminal prompt or
`--auth-passphrase-fd <number>`. The FD reader removes at most one trailing CRLF
or LF; all other whitespace is preserved. Both inputs use strict UTF-8 and the
same 1–1024-byte secret limit. ADR 0015 defines input bounds, credential rotation,
and service startup. Missing noninteractive input fails with an actionable
error; unattended startup needs an external credential provider.

Projects follow ADR 0002. `project.toml` mirrors ledger-owned format version,
engagement ID, name, kind/state, and revision. Rebuild stale/missing nonidentity
fields from verified history; reject conflicting IDs or unsupported formats.
Signed events remain unchanged during upgrades.

`registry.db` owns canonical registration paths, local operator UUIDv7, active
context, recovery intents, and core audit. Back it up with core configuration;
project exports exclude it. Imported projects preserve historical operator IDs;
new events use the receiving operator. Roster entries describe teammates without
provisioning users. Cached project labels are rebuildable.

### Create, register, and unregister

- Create accepts immutable `kind: engagement | lab`, a nonblank name, optional
  metadata, and optional absolute destination. Generate a UUIDv7 in the core;
  use it for the default directory name. Initial state is Draft or Lab by kind.
  Client name and legal artifacts are optional.
- Explicit destinations must not exist. Validate input first, then create in
  private staging with a durable registry intent. Publish after a durable
  `engagement.created` and complete layout. Recover interrupted publication/
  registration from the intent; failed-attempt cleanup removes only owned files.
- Register an existing absolute directory: acquire ownership, inspect versions,
  and verify history before writes. Require one engagement ID and recognized
  `engagement.created` genesis payload. Standalone M1 ledgers remain usable by
  M1 tools; project conversion/import belongs to M15.
- Same ID/canonical path registration is idempotent. Conflicting IDs or paths
  fail. Moves use unregister/register; missing paths can be unregistered.
  Resolve symlink aliases; reject substitution of credential/ownership files.
- Unregister requires switching away (`project_active` conflict otherwise).
  Preserve every project file/key and return `files_preserved`, path, and
  re-registration instructions. CLI prints the warning to stderr, including
  JSON mode; API includes it for clients. No confirmation prompt. Missing paths
  receive an additional availability warning.
- Keep unavailable/corrupt/unsupported registrations listed with error codes.
  Failed opens must not invoke the current create-on-open ledger behavior.

### Ownership and offline maintenance

One core owns a data directory. Each available registered project has one
exclusive owner across core instances, held until unregister or shutdown,
including while inactive. Acquire ownership before opening its ledger.

M1 `verify`, `seal`, and `log` remain offline commands: **stop the owning core
first**, then acquire the same exclusive ledger lock for the command's lifetime.
A live owner yields `ledger_in_use` and exit 75 before database access, with
instructions to stop that core. `keygen` needs no ledger lock. M2 introduces
neither API forwarding for these commands nor a shared-read exception; existing
`verify` opens storage read/write and `log` rebuilds projections.

M2.3 implements the ownership guard in core and offline CLI entry paths, using
one lock identity derived from the canonical ledger path, including standalone
M1 ledgers. Test core/CLI contention in both directions and path aliases. The
primitive must support exclusive acquisition, live-owner verification, crash
recovery, and handle release across three OSes. Timeouts/PID reuse alone cannot
justify reclaiming a lock. Unsupported filesystem locking fails explicitly.

A failed ownership acquisition leaves the registration unavailable with its
error code. Core shutdown closes database handles before releasing ownership;
offline commands release on success or failure. M2.3 tests crash recovery for
both owner types. Later CLI work preserves M1 argument/output conventions and
the existing environment-based signing-key input. Online ledger browsing uses
the authenticated events API; offline maintenance creates no context switch.

### Versions and auditing

Start with `/api/v1`, project/registry format 1, and existing ledger storage
version 1. M2 payloads use envelope `schema_version: 1`, dispatched by event type.
Preserve M1 envelope/hash semantics. Projection versions rebuild independently;
unsupported payload history blocks mutation with a version error. Raw hash
verification stays independent of domain interpretation.

Append-only `core_audit` in `registry.db` records sequence, UTC time, operator,
operation/request ID, type, and nonsecret details: configuration/wider binds,
registration/unregister, credential reset/rotation, switch recovery, and startup
availability failures. Use update/delete triggers; this is an unsigned local
audit. Commit audit and registry changes together. Required audit failure blocks
readiness, including before any project exists.

## Shared context and switching

All clients share `{ instance_id, generation, project_id }`. Instance ID changes
on restart; generation increments per selection change; project ID may be null.
Recover durable intent before readiness. Selection is independent of lifecycle.

Project routes carry explicit IDs. Reads can access any available registration;
business writes require active selection, current context, and revision.
Registry operations serialize separately. Clients refetch stale context.

The core serializes mutations/switches. Admitted work finishes against its
original project; queued work revalidates on admission. New requests during a
switch receive `switch_in_progress`. Bound outstanding work and draining.
Future runner output retains its original session/project attribution.

Switch input: destination UUID or null, expected context, idempotency key.
Initial selection is a switch. A current same-project selection is a no-op;
a stale one conflicts. Clearing selection is supported.

1. Validate target ownership, identity, versions, integrity, and projection
   loading. Persist intent with old/new selection, next generation, and event ID.
2. Drain admitted source mutations, catch up projections, and dispose resources.
   Hook deadline defaults to 5 seconds, configurable within 1–30 seconds.
3. Load target and append one `project.switched` to its ledger: source/destination
   IDs, operation ID, generation; envelope engagement ID is the destination.
   Source departure/recovery and null-target switches use local core audit.
4. Commit selection/generation and completed intent in the registry, then notify
   clients and acknowledge. Success requires both applicable commits.

Recover a crash between steps 3/4 forward using the event ID and matching
operation data. Before step 3 commits, restore the source only if its hooks can
restore usable resources; otherwise publish null context and reject mutations.
Unknown hook completion keeps the core unready until resolved/restarted. A
committed but now-unavailable target retains its recovery intent, with null
context and an actionable error until recovery can finish.

Stop default old-project subscriptions before context notification; clients
resubscribe with the new token/cursor. Explicit project-scoped read subscriptions
may survive switches by opt-in. Every frame identifies its project; cursors are
project-local. Context notifications and durable events remain distinct.

## Lifecycle and Lab identity

Maintainer-confirmed: Lab identity persists, Closed content requires reopening,
audited reopening is supported, and manual pause needs no RoE/testing window.
Immutable `kind` is `engagement | lab`; labs retain their badge in every state.

Persisted lifecycle enum: `draft`, `lab`, `active`, `paused`, `closing`, `closed`.
Two nullable persisted fields support temporary states:

- `resume_state`: Draft/Lab/Active/Closing while Paused; otherwise null.
- `closing_origin`: Draft/Lab/Active throughout Closing and a pause of Closing;
otherwise null. Preserve it across repeated closing commands and resume.

Validate saved fields against kind: an engagement's closing origin is Draft or
Active; a lab's is Lab. A paused Closing requires both `resume_state: closing`
and a valid closing origin. Other paused states have null closing origin.
Malformed combinations fail replay/mutation with an explicit history error.
Cancellation from a Paused-origin closing episode returns its saved underlying
state, as requested; it does not restore the manual pause itself. Operators can
pause the restored state again with a new audited reason.

### Persisted-state transition matrix

Unlisted edges return `invalid_transition`. Commands require context/revision
preconditions and an idempotency key. Required reasons are trimmed, nonblank,
1–2000 characters. Events carry operation ID, kind, before/after state and both
saved fields, reason (nullable), and core-generated attribution/timestamps.

| From | Command → To | Saved-state behavior | Reason |
|---|---|---|---|
| Draft | activate → Active | Engagement kind | Optional |
| Draft, Lab, Active | pause → Paused | Save source in `resume_state` | Required |
| Closing | pause → Paused | Save Closing; retain `closing_origin` | Required |
| Paused | resume → saved state | Clear `resume_state`; retain closing origin when returning to Closing | Required |
| Draft, Lab, Active | begin_closing → Closing | Save source in `closing_origin` | Required |
| Paused | begin_closing → Closing | Copy saved Draft/Lab/Active to closing origin; if saved Closing, retain existing origin; clear resume | Required |
| Closing | cancel_closing → closing origin | Restore Draft/Lab/Active; clear both saved fields | Required |
| Closing | close → Closed | Clear both saved fields; future runner quiesces first | Required |
| Closed | reopen → Active or Lab | Destination follows kind; saved fields null | Required |

Draft→Closing→cancel restores Draft, including Draft→Paused→Closing→cancel.
A paused-Closing detour preserves the original destination. Closing cancellation
never promotes Draft to Active. Draft closes through Closing; **reopening after
actual closure deliberately returns Active or Lab**, preserving prior history.
Legal artifacts and cleanup/report prerequisites remain optional in M2.

Same-key retries return the original outcome. With a new key, activate in Active,
pause in Paused, begin_closing in Closing, and close in Closed are no-ops after
precondition/reason validation; saved fields remain unchanged. Resume outside
Paused and reopen outside Closed fail.

### Effective-restriction interactions

Blackout is computed by M5 from RoE/windows, separately from persisted lifecycle.
M2 stores inputs and reports evaluation unavailable. M5 displays Blackout over
Draft/Lab/Active/Closing when restricted; Paused/Closed retain their labels with
restriction details. Window expiry therefore cannot undo manual pause.

| Interaction during Blackout | Behavior |
|---|---|
| pause | Apply the persisted-state transition and preserve its saved fields |
| begin_closing | Apply the persisted transition; restriction continues |
| Other lifecycle command | Validate underlying state; re-evaluate restriction afterward |
| Operator set/clear Blackout | Reject; policy/time evaluation owns it |

Pause stops admission of managed commands; running commands retain output and
completion. M4 defines draining/raw-session behavior and enforces Closed runner
disablement. Closing warns for persistence/destructive classes unless RoE is
stricter. M5 evaluates scope/policy on resume, reopening, and window changes.

Closed allows reads, rebuild, switching, unregister, and offline verification/
signing under the ownership rule above. Content edits, including metadata/scope
and template copying, require reopening. Export/access and switch audit events
may append. Checkpoints attest historical prefixes; new suffixes need sealing.
A stored checkpoint remains verifiable after reopening. Closing does not
automatically sign; the operator invokes offline `seal` with a signing key.

## API conventions

M2.2 defines strict Zod schemas and generates OpenAPI wire definitions.

| Operation | Route |
|---|---|
| Health; authenticated readiness/context | `GET /healthz`; `GET /api/v1/status` |
| Create/list | `POST`, `GET /api/v1/projects` |
| Register/unregister | `POST /api/v1/project-registrations`; `DELETE /api/v1/project-registrations/{project_id}` |
| Read/update metadata | `GET`, `PATCH /api/v1/projects/{project_id}` |
| Allowed transitions; command | `GET`, `POST /api/v1/projects/{project_id}/transitions` |
| Read/switch/clear selection | `GET`, `PUT /api/v1/context` |
| Scope query/add; edit/remove | `GET`, `POST /api/v1/projects/{project_id}/scope`; `PATCH`, `DELETE /api/v1/projects/{project_id}/scope/{scope_id}` |
| Ledger page; rebuild | `GET /api/v1/projects/{project_id}/events`; `POST /api/v1/projects/{project_id}/rebuild` |
| Templates list/read/copy | `GET /api/v1/templates`; `GET /api/v1/templates/{template_id}`; `POST /api/v1/projects/{project_id}/template-copies` |
| Browser WS ticket; stream | `POST /api/v1/ws-tickets`; `/api/v1/events/ws` |

Scope deletion appends a compensating event. Collections use stable IDs; omitted
patch fields stay unchanged, null clears nullable fields, arrays replace the
collection. Reject ID/kind edits. Validated no-change updates preserve revision.

Revision is the ledger head hash; every established project has one. Switch
events advance it. Business writes require quoted-hash `If-Match` and
`X-PenTrackr-Context: <instance_id>:<generation>`. Registry mutations require
context/idempotency, with registration conflicts checked serially.

Every mutation uses UUIDv7 `Idempotency-Key`, bound to operator, method, route,
and validated body. Identical completed retries return the original outcome
before stale-precondition checks; changed commands conflict. Persist key/digest
with events or registry transactions and recover outcomes after restart.
Validation failures leave keys available; in-progress retries return
`operation_in_progress`. Successful no-ops persist locally without engagement
events. Local replay records are excluded from case exports. Creation/template
copying require filesystem recovery as well as registry transactions.

Errors: `{ error: { code, message, request_id, details } }`, with safe field paths
and recovery/conflict details. Exclude secrets, raw bodies, stack traces, and
internal paths; explicit registration responses may return the project path.

| Status | Meaning |
|---|---|
| 400 | Invalid JSON, fields, dates, cursor, reason |
| 401 / 403 | Invalid credential / disallowed origin or host |
| 404 | Unknown resource; authenticate before lookup |
| 409 | Invalid transition, inactive/active-project conflict, stale context, duplicate identity, reused key |
| 412 / 428 | Stale revision / missing precondition |
| 413 / 415 | Oversized request / unsupported content type |
| 422 | Unsupported format/payload version or invalid history |
| 429 | Connection/request/backpressure limit |
| 503 | Switch/recovery, unavailable project, ownership/storage failure |
| 500 | Unexpected failure; sanitized message and request ID |

Body limit: 1 MiB (uploads M3). Pages: default 50, maximum 200. Events sort by
ascending sequence with exclusive `after_seq`; projects sort by UUID with an
exclusive ID cursor, without snapshot guarantees across registration changes.
Unavailable task/finding counts are null with capability indicators. Only
`/healthz` is public; API/schema/template endpoints require authentication.
Readiness requires authentication, ownership, and recovery completion.

Bind defaults to `127.0.0.1`; explicit `::1` is supported. Wider binding requires
an explicit address, `--allow-non-loopback`, visible warning, and configuration
audit before listening. Headless mode uses the same default. Protect bearer
transport beyond loopback with an operator-managed tunnel; native TLS/agent
transport remains later work. Host/Origin allowlists are explicit.

## Verification handoff

M2.3–M2.12 test restart/retries, interrupted creation, identity conflicts,
core/offline-CLI ownership, stale context, switch commit boundaries/timeouts,
and authenticated headless startup. M2.6 tests closing cancellation from every
origin, including paused Draft and paused Closing, with replay of saved fields;
Blackout tests belong separately to M5. M2.1 closes no additional SRS requirement.
