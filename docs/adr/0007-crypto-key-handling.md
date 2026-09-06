# 0007 — Per-project data key, OS keychain, honest zeroization limits

**Status:** Accepted (5 September 2026)
**Requirements:** FR-SECPL-003, FR-SECPL-004, FR-SECPL-010, FR-SEC-002

## Context

The vault holds credentials, tokens, tickets, and keys. Evidence blobs may
contain client data. Switching projects must unload plaintext secrets from
memory within a bounded time (FR-SECPL-004).

## Decision

A per-project data key (XChaCha20-Poly1305) wraps vault entries and evidence
blobs. The data key is wrapped by an operator key held in the OS keychain
(`@napi-rs/keyring`: Secret Service, Keychain, Credential Manager), with an
Argon2id passphrase fallback for headless and air-gapped use. The signing key is
separate from the encryption key.

Project switch drops key material and writes `project.switched`.

## Consequences

- Hardware-token support is designed for but not built in MVP.
- **JavaScript cannot guarantee zeroization.** The GC may copy buffers, so
  FR-SECPL-004 is satisfied by discipline: secrets live only in `Buffer`
  instances that are explicitly overwritten and dropped, never in `string`s,
  enforced by a lint rule and a heap-snapshot canary test after switch.
  This limit is stated in the threat model (FR-SECPL-010) rather than papered
  over — a security tool that overstates its own guarantees is worse than one
  that states them accurately.
- `keytar` is deliberately not used: unmaintained, and a keychain binding is not
  a place to accept abandonware.

## Alternatives rejected

**Single vault key across projects.** Simpler, but a compromise of one
engagement's key would expose every client's material at once.

**Passphrase only, no keychain.** Portable, but the friction pushes operators
toward weak passphrases or disabled encryption.
