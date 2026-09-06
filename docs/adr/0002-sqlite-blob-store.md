# 0002 — SQLite plus content-addressed blobs, one directory per project

**Status:** Accepted (5 September 2026)
**Requirements:** FR-CASE-001, FR-MANIFEST-001, NFR-005, NFR-007, NFR-009

## Context

The SRS assumes SQLite until a later store decision (section 31). Projects must
be portable enough to export as a case file, back up, and re-import elsewhere
with the hash chain intact.

## Decision

One self-contained directory per project:

```
<project>/
  ledger.db                # append-only events + rebuildable projections (WAL)
  blobs/ab/cd/<sha256>     # content-addressed, immutable, sharded 2/2
  vault/                   # sealed secret material
  files/                   # operator-visible working tree
  project.toml             # identity, state, schema version
```

Projections live in the same database in tables marked derived, and are dropped
and rebuilt from events on schema change. `pentrackr project rebuild` is a
supported, tested operation from the first release.

## Consequences

- One directory equals one portable unit, so case export is "seal, manifest,
  verify, archive" rather than a bespoke serializer, and backup (NFR-007) is a
  documented `cp -a` plus key material.
- Rebuild-from-events is the executable proof that projections are disposable
  and history is not. If rebuild ever becomes impractical, a design principle
  has been violated somewhere upstream.
- Content addressing gives deduplication and integrity for free, and makes
  "the same file was retrieved twice" observable rather than invisible.
- The layout deliberately resembles the `scans/ logs/ screenshots/ evidence/`
  convention already in use by hand, which keeps the importer close to mechanical.

## Alternatives rejected

**Blobs inside SQLite.** Simpler to copy, but fights NFR-005 (stream evidence,
do not load into RAM) and makes multi-gigabyte dumps a database problem.

**Postgres or a server database.** Contradicts NFR-001 (local-first, no required
control plane) and adds an installation dependency to a laptop tool.
