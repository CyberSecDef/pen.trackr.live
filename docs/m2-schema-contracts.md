# M2.2 schemas and ledger JSON transport

Implemented packages:

| Package | Responsibility |
|---|---|
| `@pentrackr/project` | Identity metadata, persisted lifecycle invariants, versioned domain payloads |
| `@pentrackr/server` | Core configuration, typed API contracts, ledger JSON codec |

Both are ESM workspaces with TypeScript declarations and runtime exports.
Dependencies are workspace packages and the existing Zod 4.5.4. The server
package currently contains contracts, not a listener. Fastify arrives in M2.8.
The core libraries use the existing Node ledger package; M2.12 generates the
browser client rather than importing these Node packages into a browser.

## Implemented boundary

The identity metadata floor contains `name`, nullable `client_name`, and nullable
`code_name`. Persisted metadata requires explicit nulls; update patches preserve
omitted fields and distinguish them from null clears. Explicit undefined patch
properties and unknown fields fail validation. M2.4 adds the remaining metadata,
including scope, RoE, windows, contacts, roster, and document references; these
fields are rejected until their schemas exist.

M2.3 may persist these version-1 events. M2.4 must retain their readers when
adding metadata: required payload changes need a new version and explicit
projection defaults for older events, rather than redefining version 1.

The persisted lifecycle schema validates kind, state, `resume_state`, and
`closing_origin` together. All 240 combinations of the defined enums/nulls are
tested against the 14 valid persisted snapshots. Blackout is excluded. M2.6
implements command-to-transition policy; structurally valid before/after states
alone do not prove that a transition is allowed.

Version-1 payloads exist for `engagement.created`, `engagement.updated`,
`engagement.state-changed`, and `project.switched`. `parseProjectEvent` validates
the complete envelope and typed payload, rejects unsupported versions/types,
and binds switch events to the destination ledger. Other event types retain
M1's generic validation until their domain schemas arrive. `operation_id` and
`command_hash` carry the identity/digest needed by M2.5 retry handling.

API schemas cover creation, registration, identity updates, transitions,
selection, pagination, preconditions, availability, unregister warnings, status,
and errors. Response validation rejects mismatched project IDs in project lists
and ledger pages. Query schemas accept typed numbers; M2.9's HTTP adapter must
parse canonical decimal query strings before validation, rejecting duplicate or
malformed parameters. It must also extract only the named concurrency headers
before using the strict header schemas.

Core config version 1 requires resolved absolute data/project directories and an
explicit credential provider. Network defaults are loopback, port 0 (OS-selected,
recorded in discovery at startup), and a 5-second switch-hook timeout. Empty
host/origin lists supply no extra grants; M2.8 derives the bound local endpoint's
allowlist. Config schema checks do not replace filesystem ownership or Origin
policy enforcement.

Tests exercise Zod-to-JSON-Schema conversion for every exported schema. JSON
Schema expresses structure; Unicode, identity, saved-state, and other custom
Zod refinements still run in the core. M2.12 must preserve runtime validation
when wiring Fastify and generating OpenAPI/client artifacts.

## Wire version 1

`toWireEvent(seq, envelope)` produces:

```json
{
  "wire_version": 1,
  "seq": 1,
  "envelope": {
    "…": "all original envelope fields",
    "payload": ["map", [["count", ["bigint", "18446744073709551615"]]]]
  }
}
```

The ellipsis above stands for the unchanged M1 fields; it is not a wire field.
Only the payload representation changes. `fromWireEvent` restores an ordinary
ledger envelope; `toWireValue`/`fromWireValue` handle individual CBOR values.

| Ledger value | JSON representation |
|---|---|
| Null, boolean, string, safe integer | Native JSON value |
| Byte string | `["bytes", "00ff"]` (lowercase, even-length hex) |
| Big integer | `["bigint", "18446744073709551615"]` (canonical decimal) |
| Array | `["array", [encoded values]]` |
| String-keyed map/object | `["map", [[key, encoded value], …]]` |

Every array and map is wrapped, so ordinary evidence resembling a tag cannot be
misread as bytes or an integer. Map entries are sorted by JS string comparison
for stable JSON presentation. Duplicate keys, malformed Unicode, noncanonical
hex/decimal, floats, unsafe JSON numbers, and integers outside CBOR's supported
range are rejected. `__proto__` and `constructor` remain ordinary map keys.

The codec checks cycles, depth (maximum 64), and node count (maximum 20,000)
before recursive parsing. These limits include tagged JSON structure; enclosing
event bodies are additionally subject to M2.8's request-size limit. Arrays must
be dense. Map/object identity and Buffer/Uint8Array identity normalize, as does
negative zero. The invariant is identical canonical CBOR bytes, not JS object
identity. Property tests exercise actual JSON stringify/parse; envelope tests
also verify the reconstructed event hash.

Codec validation does not authenticate a hash or checkpoint: use the existing
ledger verifier for that. Event envelopes, hash preimages, and stored CBOR are
unchanged by M2.2.
