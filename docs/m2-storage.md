# M2.3 storage implementation notes

The local registry is `registry.db` under the resolved core data directory. It
stores the installation's operator UUIDv7, canonical project paths, creation
intents, and unsigned append-only core audit. Each project directory contains
`ledger.db`, `project.toml`, and reserved `blobs/`, `vault/`, and `files/`
directories. Engagement identity and creation metadata come from the verified
ledger; `project.toml` is a repairable mirror. Its identity and format fields
must agree with the ledger.

Registration inspects an existing ledger through `openLedgerReadOnly`, verifies
its chain and checkpoints, and rejects an unrecognized creation event or a
second engagement identity before opening a writable handle. Missing ledgers
are never created by an inspection attempt. Until M2.5 supplies typed replay,
storage accepts only the creation event and reports later history as
`unsupported_project` instead of writing an incorrect mirror.

## Exclusive ownership

`LedgerOwnership` takes an exclusive transaction on a dedicated SQLite
rollback-journal database beside the canonical ledger path (`.owner.db`). The
same guard is used by project storage and the offline `verify`, `seal`, and `log`
commands. A lock held by a live process yields `ledger_in_use`; the CLI exits
75 before opening the ledger. The guard is held until the ledger handle closes.
The sidecar is left in place so a second process cannot create a fresh inode at
the same path while the first owner remains live. SQLite's OS file locks are
released when an owner crashes; PID age is not used for recovery. Core storage
also owns the registry using this primitive, so two cores cannot manage one
data directory concurrently. `keygen` needs no guard.

The sidecar is installation machinery, not engagement history. Backups of an
idle project may include it; it contains no credentials or event data. The
registry is local installation state and is backed up with core configuration,
not included in a portable project export.

## Creation and recovery

Creation records a registry intent, builds a private sibling staging directory,
appends `engagement.created`, writes the mirror, then renames staging to the
destination and registers it. On restart, a published destination is checked
and registered from its intent; an unpublished staging directory is removed
only when it is empty or its path, creation marker, and contents match the
recorded attempt. A failed registration
after publication leaves the intent for recovery. Unregister deletes only the
registry row and returns a structured files-preserved warning.

The mirror file and containing directory are flushed before publication on
POSIX. Node does not provide a Windows directory flush handle, so Windows
durability at the rename boundary depends on the filesystem; recovery still
uses the persisted intent and verified ledger.

This phase exposes a storage API, not an HTTP listener. M2.8/M2.9 will map
`ProjectStorageError` codes and field paths to the versioned API. M2.4/M2.5
extend the model and replay beyond the version-1 creation event. The schema
version of that event must not be reinterpreted.
