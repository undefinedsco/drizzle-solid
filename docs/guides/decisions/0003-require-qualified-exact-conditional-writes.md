# Require a qualified backend for exact conditional writes

Status: implemented API; actual published CSS fast-version contract remains unqualified.

Exact property patches and document snapshots belong in drizzle-solid rather than application-specific serializers. A snapshot retains the complete original RDF representation and its same-GET strong ETag. The explicit conditional terminal compiles a standard N3 patch without changing ordinary update/delete behavior or creating resources implicitly.

A server response alone cannot prove strict version exclusion, atomic mutation, or single-attempt transport. Use a typed backend contract and a narrow explicit conformance path. Missing capability returns `unsupported`; an uncertain submit returns `unknown`. A later equivalent representation is not evidence that this caller performed the commit.

Rejected: retry with refreshed ETags, PUT reconstruction, singular N3 patch predicates, automatic server-name detection, delayed tests to avoid ETag collisions, and boolean capability declarations.

Tests cover exact snapshots, retained terms, nested selected-property merges, ownership rejection, empty patches and actual partial HTTP responses. Real user Pod tests record the published producer's fast ETag collision and qualification refusal. These negative findings do not establish a qualified CSS positive result.

See [conditional resource writes](../conditional-resource-writes.md) for the contract and current limits.
