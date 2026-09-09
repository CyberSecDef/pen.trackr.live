# M2 core behavior contract

**Version:** 1 — M2.1, 9 September 2026
**Implementation status:** Contract only. M2.2–M2.14 implement and test it.

This document resolves the project, state, and API behavior needed before
schemas and handlers are written. It supplements the frozen SRS and
[plan](../plan.md); exceptions belong in the plan's delta table. It is a living
implementation contract. Accepted architectural choices are recorded separately
in ADRs, which are not edited to erase earlier decisions.

## Storage and identity

Paths are resolved by the core, never by the client machine. The local data
directory is selected by `--data-dir`, then `PENTRACKR_DATA_DIR`, then:

| Platform | Default data directory |
|---|---|
| Linux | `$XDG_DATA_HOME/pentrackr`, or `$HOME/.local/share/pentrackr` when unset |
| macOS | `$HOME/Library/Application Support/PenTrackr` |
| Windows | `%LOCALAPPDATA%/PenTrackr` |

Overrides must be absolute paths. An invalid configured base produces an error;
it does not fall back to the working directory. The data directory holds
`core.toml`, `registry.db`, `auth.enc` when selected, a private discovery file,
and runtime ownership metadata. Secret values never appear in `core.toml` or
discovery. Default project root is `<data-dir>/projects`; `--projects-dir` or
`PENTRACKR_PROJECTS_DIR` overrides configuration for newly created projects.
Existing registrations retain their paths. Authentication mode is explicitly
configured as `keychain` or `passphrase` (ADR 0015).

Each project directory follows ADR 0002. `project.toml` contains format version,
engagement ID, display name, kind/state, and the projected ledger revision; all
business fields are rebuildable mirrors. The ledger owns business truth. Manual
mirror edits cannot update a project. Conflicting IDs or unsupported formats
require an error; missing/stale nonidentity mirror fields can be rebuilt from
verified history. No silent schema upgrade modifies signed events.

`registry.db` owns local registration (project ID → canonical directory), the
local operator UUIDv7, active context, recovery intents, and local core audit.
Cached project labels are disposable. Registration and operator identity are
local installation data, not reconstructible from an arbitrary set of projects;
document backing up this database with core configuration. Project exports
exclude it. Ledger attribution preserves historical operator IDs after moving
a project to another installation; new events use the receiving local operator.
Roster entries can describe teammates without provisioning multiple users.

### Create, register, and unregister

- Create accepts `kind: engagement | lab`, a nonblank display name, optional
  metadata, and optionally an absolute destination. Generate the engagement ID
  in the core. Default destination uses that UUID, not a display name as a path.
  Default state is Draft for an engagement and Lab for a lab. Legal artifacts
  and client name are optional at creation.
- An explicit destination must not exist. Validate the complete input before
  creating files. Create using a private staging directory and a recoverable
  registry intent; publish only once `engagement.created` is durable and the
  layout is complete. Cleanup removes only files owned by that create attempt.
  A crash after publication but before registration is recovered using the
  intent, never by deleting a complete engagement.
- Register accepts an absolute existing directory. Inspect layout/version and
  verify history before opening it for writes. Require exactly one engagement
  identity and a recognized `engagement.created` genesis payload. A standalone
  M1 ledger remains readable by M1 tools but is not automatically promoted to a
  project. Case import is a separate M15 operation.
- Registration is idempotent for the same ID and canonical path. Reject a
  second path with the same ID or a second ID at the same path. Moving a project
  requires unregister/register, with unregister allowed for a missing path.
  Symlink aliases resolve to the same canonical registration; credential and
  ownership files themselves reject symlink substitution.
- Unregister removes the registry entry only. Require switching away first if
  it is active (`project_active` conflict). Do not touch project history, files,
  keys, or directories. Return a structured warning with code `files_preserved`,
  path, and re-registration instructions. CLI prints it to stderr even in JSON
  mode; API includes it in the JSON response for other clients. No extra
  confirmation prompt is required. Missing paths get an additional warning;
  the operation does not claim files exist when it cannot verify them.
- Missing, inaccessible, corrupt, or unsupported registered projects remain
  listed with availability and error codes. Do not remove them or invent empty
  histories. A failed open never calls the current create-on-open ledger path.

One core instance owns a data directory, and a managed project may have only one
core owner even across different data directories. Implement process ownership
with canonical paths, exclusive acquisition, live-owner verification, and crash
recovery. Never reclaim ownership merely because a timeout elapsed or a PID was
reused. Unsupported/network filesystem locking must fail explicitly rather than
claim exclusion. M2.3 chooses and tests the portable locking primitive.

### Versions and auditing

Initial versions: HTTP namespace `/api/v1`, project format 1, registry format 1,
and the existing ledger storage version 1. M2 domain payloads use envelope
`schema_version: 1` interpreted by event type. Keep the M1 hash preimage and
envelope unchanged. Projection versions are independently rebuildable. New
payload versions require explicit handlers; unsupported domain history prevents
project mutation without being mislabeled as hash tampering. Raw ledger
verification remains independent of domain interpretation.

Core configuration and registration events belong in an append-only
`core_audit` table in `registry.db`, with sequence, UTC timestamp, operator ID,
request/operation ID, type, and nonsecret structured details. It includes
configuration changes, wider-bind acknowledgment, registration, unregister,
credential reset/rotation, switch recovery, and startup availability failures.
Use database triggers against ordinary update/delete; this audit is not a
signed engagement ledger and must not be advertised as tamper-evident. Audit
and associated registry changes commit together. Failure to record a required
configuration audit prevents readiness, including before a project exists.

## Shared context and switching

Every authenticated client observes one active project per core installation.
An active project is a selection, not an engagement lifecycle state. Context is
`{ instance_id, generation, project_id }`; instance ID is fresh on each process
start, generation increments on successful selection changes, and project ID
may be null. A new process recovers durable switch intent before publishing
readiness and returns a fresh context even when it restores the same selection.

All project routes contain an explicit project ID. Reads may access any
registered available project. Business mutations require that project to be
active, its current context token, and its current revision. Inactive reads do
not switch context. Registry operations have their own serialized boundary.
Old clients must refetch context after a stale token or a service restart;
the server never substitutes the currently active ID for an explicit ID.

Mutations and switches are serialized through the core coordinator. A request
that entered before a switch completes against its original project; a queued
request is revalidated on admission and fails if context or revision changed.
New requests during a switch receive `switch_in_progress`, not indefinite
queueing. Bound outstanding work and draining. Long-running runner processes
later retain their original project/session attribution independently of UI
selection; switching must not reassign their output to a new ledger.

Switch request: destination UUID or null, expected context, and an idempotency
key. Initial selection counts as a switch. Selecting the already active project
with current context is a no-op: no new event or generation. A stale same-target
request still conflicts. Clearing selection is supported.

1. Validate target ownership, identity, versions, ledger integrity, and ability
   to load projections before disrupting the source. Persist a local switch
   intent with old/new selection, next generation, and a preallocated event ID.
2. Drain admitted source mutations, catch up its projections, and run registered
   disposal hooks. Hooks have a default 5-second deadline, configurable within
   1–30 seconds; an unacknowledged timeout never counts as successful disposal.
3. Load the target context. Append exactly one `project.switched` to the
   **destination ledger**, with source/destination IDs, operation ID, and new
   generation. Envelope engagement ID is the destination. The source ledger is
   not also written: departure/recovery is recorded in local core audit. A
   switch to null writes only core audit, never a fictitious engagement event.
4. Commit active selection/generation and completed intent in `registry.db`,
   then publish the context notification and acknowledge. A successful response
   means both project audit (where applicable) and local selection are durable.

A crash between steps 3 and 4 is recovered forward using the preallocated event
ID: if present with matching operation data, finalize selection without another
append. Before that commit point, abort to the old selection only if its hooks
can restore a usable context; otherwise leave context null with a recovery
error and refuse business mutations. A timed-out hook with unknown completion
keeps the core unready until resolved or restarted. If the target event exists
but the target cannot now be loaded, retain recovery information, expose null
active context and an actionable unavailable-project error; never say the
switch was rolled back by erasing history.

Default event subscriptions follow active context: stop old-project delivery
before publishing the new context and require explicit subscription with its
new token/cursor. An explicitly project-scoped read subscription can survive
a selection change only if the client opted into it; every frame retains its
project ID. Cursors never carry across projects. State-change, context-change,
and durable ledger-event messages are distinct.

## Lifecycle and Lab identity

The confirmed rules are audited reopening and manual pause without RoE/windows.
Two defaults were raised with the maintainer during M2.1: immutable Lab identity
and reopening before Closed content edits. The following uses those defaults;
they are design choices, not additional user approvals. Record any subsequent
answer before implementing M2.2/M2.6.

`kind` is `engagement` or `lab`, immutable in M2. A lab starts in Lab and always
retains a Lab badge, including while Paused, Closing, or Closed. An engagement
starts in Draft. No conversion between kinds is introduced. Internally the
persisted lifecycle states are `draft`, `lab`, `active`, `paused`, `closing`,
and `closed`. API/UI labels use the capitalization in the SRS.

Blackout is an **effective restriction**, not a substitute for the operator's
underlying lifecycle intent. M5 computes it from configured RoE/time windows
and records restriction changes. M2 stores those inputs and reports restriction
evaluation as unavailable, never as an evaluated allow verdict. In M5, effective
state is Blackout while a relevant restriction applies to Draft, Lab, Active,
or Closing; Closed and manual Paused remain visible as those states, with
restriction details separate. Thus a window ending cannot undo a manual pause.
This refines SRS §3.2's display states without removing the Blackout state or
moving execution enforcement into M2.

### Transition matrix

These are the complete operator commands. An unlisted edge is rejected with
`invalid_transition`. Every command requires the shared-context/revision
preconditions and an idempotency key. Reason is a trimmed nonblank string of
1–2000 characters where required. Transition events contain operation ID,
previous/next lifecycle state, kind, reason (null if optional and omitted),
and previous/new resume state. Attribution and timestamps come from the core.

| From | Command → To | Preconditions and effects | Reason |
|---|---|---|---|
| Draft | activate → Active | Engagement kind; legal artifacts optional | Optional |
| Draft | pause → Paused | Save Draft as resume state; no RoE/window prerequisite | Required |
| Lab | pause → Paused | Save Lab as resume state | Required |
| Active | pause → Paused | Save Active as resume state | Required |
| Closing | pause → Paused | Save Closing as resume state | Required |
| Paused | resume → saved state | Resume only saved Draft/Lab/Active/Closing; clear resume field | Required |
| Draft, Lab, Active | begin_closing → Closing | No report/cleanup prerequisites in M2 | Required |
| Paused | begin_closing → Closing | Discard saved resume state | Required |
| Closing | cancel_closing → Active or Lab | Engagement returns Active; lab returns Lab | Required |
| Closing | close → Closed | Clear resume state; future runner must quiesce before acknowledging closure | Required |
| Closed | reopen → Active or Lab | Engagement returns Active; lab returns Lab; preserves all prior history/checkpoints | Required |
| Blackout (effective) | pause → Paused | Apply to underlying Draft/Lab/Active/Closing; preserve that resume state | Required |
| Blackout (effective) | begin_closing → Closing | Underlying state changes; effective Blackout persists if restriction still applies | Required |
| Blackout (effective) | underlying-state command | Only an otherwise allowed edge; cannot clear/bypass a restriction | As above |
| Any | set/clear Blackout | Operator command rejected; M5 derives restriction from current policy/time | — |

Draft cannot close directly; use begin_closing then close. Reopening does not
return to Draft and never erase the preceding close event. Lab and Active are
the runnable identities for their respective kinds, not interchangeable states.
No required document, testing window, or RoE is added by these transitions.

A completed retry with the same idempotency key returns the original outcome
without another event. With a new key, a command already satisfied in its target
state is a no-op only for activate in Active, pause in Paused, begin_closing in
Closing, and close in Closed. It must still pass current context/revision and
reason validation. A new resume outside Paused or reopen outside Closed is an
invalid transition, not a way to bypass state rules.

Manual pause prevents admission of new managed commands; it does not kill a
running command or erase its completion output. M4 defines process draining and
existing/raw-session behavior with the SRS's raw-capture rules. Closed disables
runner use; M2 exposes that eligibility but has no runner to enforce it. In
Closing, persistence/destructive classes warn by default unless a stricter RoE
rule applies. M5 combines state, scope, and restrictions; no transition grants
an execution override. Window end, resume, and reopening all re-evaluate policy
when that engine exists.

Closed projects permit reading, verification, checkpoint signing, projection
rebuild, switching, and unregistering. Metadata/scope edits and template copying
require reopen. Future export/access auditing and core `project.switched`
events may still append; Closed does not make the SQLite file physically
immutable. Signed checkpoints attest prefixes: later reopening and audit events
do not invalidate prior checkpoints or pretend the new suffix is already sealed.
The runner/vault/cleanup/report hooks integrate in their scheduled milestones.

## API conventions

M2.2 implements strict Zod schemas; generated OpenAPI is authoritative for wire
field definitions. This contract sets behavior, not a second handwritten schema.

| Operation | Route |
|---|---|
| Minimal health; authenticated readiness/context | `GET /healthz`; `GET /api/v1/status` |
| Create/list projects | `POST /api/v1/projects`; `GET /api/v1/projects` |
| Register an existing directory | `POST /api/v1/project-registrations` |
| Unregister only | `DELETE /api/v1/project-registrations/{project_id}` |
| Read/update project metadata | `GET`, `PATCH /api/v1/projects/{project_id}` |
| Allowed transitions; state command | `GET /api/v1/projects/{project_id}/transitions`; `POST /api/v1/projects/{project_id}/transitions` |
| Read/switch/clear shared selection | `GET`, `PUT /api/v1/context` |
| Scope query; add/edit/remove include/exclude objects | `GET`, `POST /api/v1/projects/{project_id}/scope`; `PATCH`, `DELETE /api/v1/projects/{project_id}/scope/{scope_id}` |
| Ledger page; rebuild projections | `GET /api/v1/projects/{project_id}/events`; `POST /api/v1/projects/{project_id}/rebuild` |
| List/read templates; copy to project files | `GET /api/v1/templates`; `GET /api/v1/templates/{template_id}`; `POST /api/v1/projects/{project_id}/template-copies` |
| Browser WS ticket; event stream | `POST /api/v1/ws-tickets`; `/api/v1/events/ws` |

Scope writes are typed domain commands. Removal is a compensating event;
`DELETE` never deletes a ledger row. Other metadata collections use stable IDs
and explicit patch semantics. Missing patch fields mean unchanged; null clears
only nullable fields; arrays replace the named collection, never merge by
position. Immutable ID/kind fields are rejected on updates. A no-change update
returns the existing revision without an event after validating preconditions.

Revision is the current ledger head hash (null only before genesis, never for
an established project). A switch audit event therefore advances revision too.
Business mutations use `If-Match` with the quoted head hash and
`X-PenTrackr-Context: <instance_id>:<generation>`. Missing preconditions yield
428, stale revision yields 412, stale context/inactive project yields 409.
Registry mutations require current context and an idempotency key, but no
engagement revision; they serialize and revalidate registration conflicts.

Every mutation supplies a UUIDv7 `Idempotency-Key`. Bind it to authenticated
operator, method, route, and validated command body; identical completed retries
return the original outcome before checking now-stale revision/context. A retry
can never perform new work using stale preconditions. Reusing a key with another
command yields 409. Persist the key and command digest with the authoritative
event (or registry transaction), and reconstruct outcomes after restart. Event
hash inputs are server-created. Failed validation never reserves a key; an
operation already underway returns `operation_in_progress` until resolved.
Persist successful no-op outcomes in the local operation registry without a
spurious engagement event; retain their request identity for later retries.
Local request replay records travel with the core registry, not a case export.
Document and test recovery for filesystem operations such as template copying
and creation, where a registry transaction alone cannot prove completion.

Error body is `{ error: { code, message, request_id, details } }`. Details contain
field paths and safe conflict/recovery information, never credentials, raw
request bodies, stack traces, or arbitrary internal filesystem information.
An explicit local registration/unregister response may return the requested
project path. Status mapping:

| Status | Meaning/examples |
|---|---|
| 400 | Invalid JSON, fields, dates, cursor, or transition reason |
| 401 / 403 | Missing/invalid credential / disallowed origin or host |
| 404 | Unknown resource; authenticate before resource lookup |
| 409 | Invalid transition, inactive/active-project conflict, stale context, duplicate identity, reused operation key |
| 412 / 428 | Stale revision / missing required precondition |
| 413 / 415 | Request too large / unsupported content type |
| 422 | Unsupported project format or payload version, invalid project history |
| 429 | Connection/request/backpressure limit |
| 503 | Switch/recovery in progress, unavailable project, ownership or storage unavailable |
| 500 | Unexpected failure with request ID and sanitized message |

Default HTTP body limit is 1 MiB; uploads are M3. Page size defaults to 50,
maximum 200. Events sort by ascending per-project sequence and use an exclusive
`after_seq` cursor. Project lists sort by immutable UUID, with an exclusive ID
cursor; live registration changes do not provide a snapshot across pages.
Unavailable counts for tasks/findings are null with capability indicators,
not fabricated zeros. `/healthz` reveals only process health; every API/schema/
template/project endpoint requires authentication. Readiness is false before
authentication, storage ownership, and recovery are ready.

Default bind is explicit `127.0.0.1`; `::1` is a supported explicit alternative.
Do not resolve a hostname into an accidental wildcard bind. Non-loopback binding
requires `--allow-non-loopback` plus an explicit bind address, prints a warning,
and records the acknowledgment and effective configuration in core audit before
listening. Headless mode does not change this default. Plain HTTP bearer
credentials require a protected transport outside loopback (for example an
operator-managed tunnel); native TLS/remote-agent transport is not added here.
Host and Origin allowlists are explicit, never wildcard credentialed CORS.

## Verification handoff

M2.3–M2.12 add executable tests for these contracts, particularly operation
retries after a lost response, failed creation after publication, project-ID
conflicts, stale context on restart, switch failure before/after its commit
point, hook timeouts, missing projects, and authenticated headless operation.
M2.1 changes documentation only and closes no additional SRS requirement.
