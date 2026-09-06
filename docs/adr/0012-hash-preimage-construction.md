# 0012 — Hash preimage: domain separation, no redundant suffix

**Status:** Accepted (5 September 2026)
**Supersedes:** the preimage formula in [0004](0004-event-envelope-hash-chain.md). Everything else in 0004 stands.
**Requirements:** FR-SECPL-001, FR-SECPL-002, NFR-009

## Context

ADR 0004 specified:

```
this_hash = SHA-256(canonical_cbor(envelope_without_this_hash) || prev_hash)
```

Implementing it in M1.3 surfaced two problems.

**The suffix is redundant.** `prev_hash` is already a field of the envelope, so it
is already inside `canonical_cbor(envelope_without_this_hash)`. Appending it a
second time binds nothing further.

**It has no defined genesis form.** The first event has `prev_hash = null`.
Concatenating null requires inventing a byte representation — an empty string, a
zero block, the literal `null` — and every implementation would have to agree on
which. That is a compatibility trap in the one place the project can least
afford one.

Separately, 0004 specified no domain separation, so the encoding of an event is
just the encoding of a map. Any other structure that happened to encode to the
same bytes would produce the same hash.

## Decision

```
preimage  = utf8("pentrackr/event/1") || canonical_cbor(envelope_without_this_hash)
this_hash = lowercase_hex(SHA-256(preimage))
```

`prev_hash` remains an envelope field, so the chain binding is unchanged. The
domain tag is versioned: a future change to the preimage construction increments
it rather than silently reinterpreting existing hashes.

## Consequences

- Genesis needs no special case. `prev_hash: null` encodes as CBOR null like any
  other absent value.
- The tag makes a Pen Trackr event hash mean "a Pen Trackr event", not "some CBOR
  map". Cheap insurance, standard practice.
- Existing chains are unaffected: nothing has been written yet. Had any ledger
  existed, this would require a migration event rather than a redefinition.

## A limitation this does not fix, stated plainly

**A hash chain detects modification, reordering, insertion, and deletion in the
middle. It does not detect truncation of the tail.** Removing the last N events
leaves a shorter chain that verifies perfectly, because every remaining link is
intact.

This matters for the product's central claim. An operator proving what they did
is protected; an operator proving what they *did not* do is only protected up to
the last signature. Truncation is addressed by interval signatures over
(count, head hash) in M1.5 and by sealing at close, not by the chain itself.

The threat model (FR-SECPL-010) must say this in the same words. Overstating what
a hash chain proves is precisely the kind of claim that collapses under
adversarial questioning, and the product's value depends on the claim holding.
