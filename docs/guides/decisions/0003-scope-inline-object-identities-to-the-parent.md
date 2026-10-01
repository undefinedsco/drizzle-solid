# Decision Record: scope-inline-object-identities-to-the-parent

- Status: `accepted`
- Area: `core-api`
- Date: `2026-10-02`

## Context

Multiple row subjects can share one RDF document. Deriving an inline object node from only the document, column and array index makes those rows share one child. Reads then merge unrelated values, and updating or deleting one row can alter another row's nested data.

## Decision

All generated inline object identifiers include the concrete parent subject's fragment, column name and element index. The triple builder and both subject/URI resolvers use one helper. Parent fragments and column names are escaped separately so separator characters cannot alias another child's path.

Explicit child identifiers remain authoritative. A document subject without a fragment retains its existing `#column-index` child shape. For example, `index.ttl#first` and `index.ttl#second` generate different metadata children rather than both using `index.ttl#metadata-1`.

## Migration and validation

The reader continues to follow stored child links. This change prevents new implicit collisions; it cannot reconstruct ownership once multiple old rows already share a child. Do not guess ownership by selecting the first value of an array. Repair affected data from authoritative per-row inputs.

The regression gate inserts two Task-shaped rows in one real Pod document, verifies distinct metadata links, then updates and deletes one row while checking that the other row's metadata remains unchanged. Unit coverage also checks nested descendants and escaped separators.
