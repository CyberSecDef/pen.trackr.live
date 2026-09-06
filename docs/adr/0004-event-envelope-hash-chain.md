# 0004 — Canonical CBOR event envelope with a SHA-256 hash chain

**Status:** Accepted (5 September 2026)
**Requirements:** FR-SECPL-001, FR-SECPL-002, NFR-009, NFR-010

## Context

The ledger may become evidence in a dispute over whether a tester caused an
outage. It must be append-only, tamper-evident, and deterministically
re-exportable (NFR-009).

## Decision

Every event carries:

```
event_id (UUIDv7)  prev_hash  this_hash  ts_utc  ts_local  tz
operator_id  engagement_id  schema_version  type  payload
```

`this_hash = SHA-256(canonical_cbor(envelope_without_this_hash) || prev_hash)`.

Interval ed25519 signatures every N events and on seal, with the key in the OS
keystore. `pentrackr verify` walks the chain and names the first divergent event.

## Consequences

- Canonical CBOR rather than JSON means the chain is not hostage to key ordering
  or float formatting. This is what makes deterministic export achievable rather
  than aspirational.
- A library's "canonical mode" is a claim until tested, so CI verifies the
  encoder against RFC 8949 test vectors.
- Corrections are compensating events. There is no UPDATE path on history, which
  removes an entire class of "the tool let me quietly fix it" failure.
- Storing UTC, local time, timezone name, and measured clock offset (NFR-010)
  costs bytes on every event and is worth it — it is the difference between
  correlating with a defender's timeline and arguing about it.

## Alternatives rejected

**JSON with sorted keys.** Sorting is not enough: number formatting, Unicode
normalization, and whitespace all vary between serializers.

**Signing every event.** Stronger, but the cost lands on the runner's hot path
(NFR-003). Interval signatures bound the tampering window without paying per
command.
