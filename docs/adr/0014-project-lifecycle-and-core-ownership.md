# 0014 — Event-owned projects, one shared selection, recoverable switching

**Status:** Accepted (9 September 2026)
**Clarifies:** [0002](0002-sqlite-blob-store.md) and [0003](0003-loopback-api.md)
**Requirements:** FR-ENG-001, FR-ENG-015, FR-UI-003, FR-SECPL-001; SRS §3.2
**Plan:** M2.1; maintainer decisions D26–D27, delta Δ9

## Context

M1 supplies a generic ledger but no project ownership, payload-specific domain
rules, or shared client context. ADR 0002 includes state in `project.toml`, while
the architecture requires business truth to come from the ledger. Project
switching must be recoverable across independent project databases.

The maintainer requires audited reopening, manual pause without legal/window
metadata, and unregistering with files preserved and a user-visible warning.

## Decision

Project metadata, kind, lifecycle, and scope derive from engagement events.
`project.toml` is an identity/version marker and recoverable metadata mirror,
not a second editable source of truth. A project has one engagement ID; the
project service rejects foreign identities and unrecognized domain history.
M1's generic ledger interface remains available for verification.

A local registry owns registration paths, operator identity, active selection,
recovery intents, and core configuration audit. These are local installation
facts, distinct from portable engagement truth. Configuration audits have a
destination even when no engagement exists. Registry audit is append-only by
database convention/triggers, with no claim of signed tamper evidence.

All clients share one selected project. Project operations identify their
project explicitly; business mutations require an active-context token and
expected ledger revision. Core restart changes the context instance ID so stale
clients cannot accidentally reuse an old generation. Selection and engagement
lifecycle are separate: selecting a Closed project does not reopen it.

The core serializes project mutations and context changes. A successful switch
writes `project.switched` to the destination ledger, then finalizes the registry
selection; a persisted operation intent allows recovery across that boundary.
Source departure and switches to no project are audited locally. The source
ledger is not a second half of a purported atomic engagement transaction.

Unregister removes only the local registration. It requires switching away
first and returns a files-preserved warning with the path and re-registration
instructions. No implicit file deletion or retention scheduler is introduced.

The full behavioral definition, transition table, storage locations, API error
and concurrency contract, and recovery outcomes are in
[the M2 core contract](../m2-core-contract.md). That document is maintained as
schemas and tests are implemented; changing this ADR's architectural choices
requires a new ADR.

Lab identity remains separate from its temporary lifecycle state; closing or
pausing a lab does not erase its classification. Closed content is edited by
audited reopening. These are implementation defaults chosen during M2.1, raised
as questions to the maintainer; they are not attributed as explicit maintainer
decisions. If revised, record the change before implementing dependent schemas.

## Consequences

- Rebuilds cannot silently adopt manually edited metadata from project files.
- Two clients cannot overwrite each other's changes without a revision conflict,
  and a background request cannot silently follow a project switch.
- Destination-only switch history avoids a second engagement append but leaves
  source departure history in local core audit. A portable case does not contain
  the full installation's project-switch history.
- Recovery is a real implementation requirement: a committed destination event
  may precede the registry update. Tests must exercise each boundary.
- A local registry backup is needed to preserve registrations and local operator
  identity. Project directories remain portable without it.
- Checksums and append-only triggers do not replace filesystem access control.
  Ownership checks prevent cooperating core processes from racing; they do not
  make hostile direct filesystem writes impossible.

## Alternatives rejected

**Project state independently editable in TOML.** Makes rebuild depend on data
outside the ledger and permits unaudited lifecycle changes.

**Each client chooses its own active project.** Conflicts with the shared
selection required by FR-UI-003 and weakens stale-context protection.

**Write both engagement ledgers as if one transaction.** Independent SQLite
databases require recovery anyway; a single destination event plus local intent
has fewer cross-database commit steps and a defined recovery direction.

**Remove means delete files.** Contrary to the maintainer's explicit decision.
