# Conditional writes to exact resources

`readResourceSnapshot(table, iri)` reads one complete RDF document with one GET. It retains the complete RDF terms and the strong ETag from that response. A fragment IRI selects the subject inside that document; it does not select a collection. The operation does not create a resource, register a TypeIndex, or initialize a session implicitly.

```ts
const snapshot = await db.readResourceSnapshot(messages, messageIri);
const result = await db.update(messages)
  .set({ metadata: { protocols: { matrix: { eventId } } } })
  .whereByIri(messageIri)
  .executeConditional({ snapshot });
```

The conditional terminal patches only selected properties. `undefined` omits a property, `null` removes it, arrays replace that property's values, and partial inline objects preserve their other properties. A partial object in an existing JSON literal merges object keys, retaining unselected keys. Empty partial objects do not create empty inline nodes. Unknown root and owned metadata assertions retain their RDF terms, including language and datatype. No schema defaults are injected.

`delete(table).whereByIri(iri).executeConditional({ snapshot })` removes that exact subject's outgoing assertions and its proven owned inline metadata, preserving other subjects in the same document. Inline ownership requires a single incoming edge and a blank node or an explicitly declared same-document inline object. Shared nodes, cross-document inline ownership, inverse properties, ambiguous bindings, SQL, collection predicates and `returning()` are refused. Named links do not implicitly convey ownership. New blank nodes are not supported. Ordinary `execute()`, promise chaining and existing update semantics remain unchanged.

Snapshots are tied to the originating table object, exact subject and authenticated fetch. They cannot be recreated by copying a JavaScript object. Partial HTTP responses and weak/missing ETags cannot establish ownership. Snapshots must not be hydrated into rows and serialized back as full document replacement.

A minimal reusable example is in `examples/utils/conditional-resource.ts` and is tested without implicit initialization or mutation. Conditional terminals do not run the ordinary hydrated-row update/delete hooks or return hydrated rows. Applications can act on the typed outcome without a second victory read.

## Backend contract

Configure `drizzle(session, { conditionalWriteBackend })` explicitly. Without a backend, the terminal returns `unsupported` before any mutation. The backend declares its canonical `fetch` and receives the snapshot's authenticated transport in `execute(patch, context)`. Both the ORM and strict implementation reject a different transport before submission; credentials from another session cannot silently perform the write. A `ConditionalWriteBackend` must guarantee exact strong `If-Match` validation, including an equivalent-result competitor; atomic standard N3 Patch evaluation; and one transport attempt. A 2xx status from an arbitrary server does not establish these guarantees.

`StrictIfMatchN3Backend.qualify({ fetch, scope, probeDocument })` provides a generic implementation and an explicit conformance check. The caller must provide a unique, exclusively owned probe document inside a narrowly reviewed implementation scope and a canonical authenticated transport that does not replay mutations. The check creates only that absent document using `If-None-Match: *`, verifies immediate version changes across consecutive writes, stale matching non-noop and equivalent-result rejection, atomic failure, and conditional cleanup. It uses plural `solid:deletes`, `solid:inserts`, and `solid:where` in `text/n3`.

A successful probe is evidence for the tested implementation, scope and transport at that time. It is not a durable server attestation or a permission to extend scope to other servers or implementations. Maintain the implementation and transport contract independently. Authentication failures remain errors. Probe creation/qualification is separate from every snapshot and terminal call.

If qualification fails or its outcome is uncertain, the implementation retains the probe and attaches `probeDocument` and `probeRetained` to the original error. It cannot assume an unqualified server honors conditional cleanup. It never refreshes to an altered document's version to delete it. Review retained probes within the caller's owned test/deployment scope; do not automatically delete unknown resources. Successful qualification verifies the expected owned representation and version before a conditional cleanup attempt.

## Outcomes

- `applied`: the configured backend acknowledged the single conditional mutation under its contract.
- `conflict`: HTTP 409 or 412; read a new snapshot and make a new application decision.
- `unknown`: submission or response completion was uncertain. Do not retry or infer ownership of a commit from a later GET that happens to contain the desired values.
- `unsupported`: no qualified backend or the resource lies outside its scope.

HTTP 401/403 remain exceptions with the status intact. The terminal does not issue a HEAD, replace the snapshot version, drop conditions, retry, use PUT, select another protocol, or read back a victory claim.

The current published Xpod 0.3.71 test producer changed RDF content while retaining a seconds-granularity strong ETag during fast writes. Cross-second stale writes were correctly rejected, but the fast version collision fails this contract. This producer is not qualified by these APIs. The protocol regression remains failing until its server version contract is corrected; waiting between writes is not a qualification fix.

After an applied result, the existing query engine HTTP cache is invalidated without initializing an engine. A maintenance failure leaves the result applied and is reported in `maintenanceErrors`; it never retries the mutation or performs a victory GET.
