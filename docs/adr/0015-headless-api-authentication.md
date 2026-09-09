# 0015 — Explicit credential providers for desktop and headless API access

**Status:** Accepted (9 September 2026)
**Extends:** [0003](0003-loopback-api.md), API credential storage and handoff only
**Requirements:** NFR-001, NFR-002, FR-UI-012
**Plan:** M2.1, M2.10; maintainer decision D28
**Review amendment:** FD newline handling corrected before implementation at the
maintainer's request; supersedes the byte-exact input wording at `c4d1c95`.

## Context

M2 must operate on headless Linux without a desktop session or OS keychain.
The maintainer explicitly selected this scope. ADR 0003 assumes a keychain
token; ADR 0007 concerns separate engagement encryption/signing keys and does
not supply an API authentication fallback.

## Decision

One HTTP/WS authentication contract uses two explicitly selected credential
providers: `keychain` and `passphrase`. The configured provider is persisted in
local core configuration; failure of one never silently selects the other or
starts an unauthenticated server.

Both providers store the same kind of randomly generated API bearer token,
scoped to this local core installation. This token grants the single operator's
API access, not remote-agent pairing or future plugin capabilities. No password
is sent to HTTP or WS endpoints. Authentication remains necessary on loopback.

The passphrase provider stores the token encrypted in `auth.enc` beneath the
core's private data directory, outside every project. Initialization prompts
twice for a new passphrase, creates the token, and writes an authenticated,
versioned encrypted credential container atomically. It never prints the token.
Opening an existing store does not recreate it on corruption or unlock failure.

Interactive core and CLI processes unlock through a hidden terminal prompt.
Noninteractive processes use `--auth-passphrase-fd <number>`: the argument is a
descriptor number, never a secret. A bounded, EOF-terminated UTF-8 byte sequence
is read from that descriptor. Remove **at most one trailing line ending**:
one CRLF pair if present, otherwise one LF. Preserve all other bytes, including
spaces, internal newlines, a lone CR, and additional trailing newlines. Decode
UTF-8 strictly, without Unicode normalization. A terminal prompt excludes its
Return terminator, producing the same secret as FD input with or without one
LF/CRLF terminator. Shell `echo` output therefore matches an interactively set
passphrase; secrets still must not be literal arguments in service definitions.

Bound the raw FD input to 1026 bytes (1024 plus a possible CRLF). After removing
the terminator, require 1–1024 UTF-8 bytes. Reject invalid UTF-8 or input not
completed within 30 seconds. Close the descriptor after reading. Apply the same
encoding and normalized length limits to terminal input. M2.10 tests unterminated,
LF, CRLF, preserved spaces, repeated newlines, invalid UTF-8, and size boundaries.
The descriptor is dedicated to authentication, not ordinary stdin used for
metadata input, and is never inherited by subsequently launched children.

The CLI uses the same provider to decrypt the credential locally and sends the
bearer token in an Authorization header. It need not retrieve credentials from
an unauthenticated running core. A service manager or other external credential
provider must supply the descriptor for unattended startup. Storing the unlock
passphrase next to `auth.enc` is not an unattended-startup solution.

Core configuration, discovery files, errors, audit records, URLs, logs, and
project files contain no API token or passphrase. Linux private directories
and files require owner-only access (0700/0600), expected ownership, and no
symlink substitution at credential access. Test equivalent owner-only access
controls on other platforms, including Windows ACLs.

Browser clients will exchange an authenticated HTTP request for a random,
single-use WS ticket, valid for 30 seconds and bound to the allowed browser
origin and credential generation. A ticket is supplied in the first WS frame,
not a URL. The socket sends no project information until authentication and
closes after 5 seconds without it. Native clients may authenticate the upgrade
with the bearer header. Tickets are consumed once, held only in memory, and
invalidated by rotation/restart. Unauthenticated sockets have bounded connection
and message limits. Browser launch credential delivery is an M2.10/M2.12 task;
it must not introduce a long-lived token in argv, a URL, or browser persistence.

Rotation atomically replaces the provider's credential and increments its
generation, then invalidates HTTP credentials, tickets, and existing WS sessions
from the previous generation before acknowledging success. Requests already
committed are not rolled back. Rotation serializes against new authenticated
mutations so the acknowledgment has a defined boundary. Interrupted rotation
must leave one recoverable current credential; recovery occurs before readiness.

Loss of the passphrase requires explicit local credential reset with the core
stopped. Reset replaces only API credentials, invalidates old sessions on the
next start, and emits a nonsecret local audit record. It does not modify project
history, signing keys, or vault keys. Changing a known passphrase rewraps the
existing token; token rotation is a separate operation.

The encrypted format's algorithm, password-KDF parameters, salts/nonces,
authenticated header, resource ceilings, and test vectors are a prerequisite
within M2.10, recorded in a further implementation ADR after reviewing the
supported runtime. This ADR fixes provider and lifecycle behavior; it does not
claim that an encrypted format or authentication code exists yet.

## Consequences

- Desktop and headless clients use the same API with different local unlock
  mechanisms. Neither mode needs a hosted identity service.
- A separately invoked headless CLI needs a prompt or externally supplied
  passphrase descriptor; no background unlock agent is introduced in M2.
- Headless deployment is tested without Secret Service or a desktop session,
  including startup, CLI access, WS reconnect, restart, rotation, tampering,
  wrong passphrases, permissions, and absence of secrets in output.
- This protects API credential storage. It does not claim protection against a
  process that already controls the operator account or can inspect core memory.
  Buffer disposal follows ADR 0007's stated JavaScript limits.
- Wider network binding still needs explicit configuration and a warning;
  choosing headless mode does not enable remote access.

## Alternatives rejected

**No authentication when a keychain is absent.** Removes the API boundary on the
very installations this decision is meant to support.

**Plaintext token in a project or user config file.** Contradicts the accepted
M2 credential-storage requirement and couples project portability to core access.

**Secrets in command arguments or automatic environment fallback.** Makes
credential input implicit and easy to capture. A dedicated inherited descriptor
provides an explicit noninteractive interface without either mechanism.

**Build the engagement vault first.** Moves M7 into M2 and conflates credentials
for connecting to the application with secrets stored as engagement evidence.
