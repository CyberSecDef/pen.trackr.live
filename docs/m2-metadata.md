# M2.4 engagement metadata contracts

M2.4 adds strict version-2 domain schemas in `@pentrackr/project` and matching
server command schemas. The M2.3 project storage operation still accepts only
its version-1 identity request, so it cannot silently drop the new fields.
M2.5 will make version-2 creation and updates durable, project them, and teach
storage inspection to open their history. The existing version-1 creation and
update readers remain unchanged. `metadataV2FromV1` supplies deterministic
empty and null defaults when M2.5 replays older creation events.

The model keeps one local operator identity. A roster member marked
`local_operator` carries that operator's UUID in stored metadata; at most one such member exists. The client command omits `operator_id`, and the core fills it from the persisted registry identity.
Every other member is an `external` participant with a name, role, stable
roster ID, and null platform identity. M2.5 binds new local-operator writes to
the registry's persisted operator ID. Multi-user accounts are not part of this
model.

When a project moves to another installation, its former local-operator mapping
remains in history. Opening it does not rebind that mapping. M2.5 must provide
an explicit audited reassignment to the new installation's operator identity.

Scope is null when absent and may be explicitly present with empty inclusion
and exclusion arrays. Objects have stable UUIDv7 IDs across both arrays.
Supported kinds are CIDR, IP, domain, HTTP URL, ASN, cloud account,
subscription, tenant, repository, and mobile app. Validation is local syntax
validation only; it does not resolve a name, contact a target, or decide scope
membership. Collection replacement, correction, and removal events belong to
M2.5; evaluation belongs to M5.

Legal fields are optional metadata and opaque future document UUID references.
They contain no bytes or filesystem paths. M3 will add attachment storage and
retrieval. RoE, destructive policy, retention instructions, and time windows
are data at this phase; they are not execution or deletion controls.

Window endpoints are local wall times paired with an IANA timezone. No UTC
offset is required. Valid endpoints resolve to one instant; nonexistent and
ambiguous times at daylight-saving changes are rejected with a field error.
Start must precede end. `localInstant` returns the canonical epoch instant;
the entered zone remains part of the stored window. M5 uses these validated
inputs to evaluate effective restrictions.

Patch commands distinguish omission from clearing a nullable field with null.
Arrays replace their collection when sent, including an explicit empty array.
Immutable engagement identity and kind are not metadata patch fields. The
server must never accept a client-authored ledger envelope as a mutation body.
