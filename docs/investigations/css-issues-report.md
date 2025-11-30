# CSS (Community Solid Server) Issues Investigation Report

**Date:** 2025-11-30
**Context:** Detected during `drizzle-solid` integration testing with a customized CSS instance.

This document records two critical issues observed when interacting with the Community Solid Server using `drizzle-solid`. These issues forced the adoption of a "Read-Modify-Write" (PUT) strategy instead of the preferred "N3 Patch" strategy.

We need to investigate if these are regressions caused by our custom modifications to CSS or inherent issues in the upstream CSS codebase.

---

## Issue 1: N3 Patch `solid:delete` Failures with Integer Literals

**Severity:** High (Data Integrity / Data Duplication)
**Component:** LDP / N3 Patch Handler

### Description
When using N3 Patch to update a resource, `solid:delete` operations fail to remove existing triples if there is a slight mismatch in the representation of Integer Literals (e.g., shorthand `20` vs canonical `"20"^^xsd:integer`), even though they are semantically equivalent in RDF.

This results in **Data Duplication**: the old value remains (because delete failed), and the new value is inserted.

### Steps to Reproduce
1.  Create a Turtle resource with an integer property:
    ```turtle
    <#me> <http://schema.org/age> 20 .
    ```
2.  Send a `PATCH` request (`Content-Type: text/n3`) to update the value to `99`:
    ```turtle
    @prefix solid: <http://www.w3.org/ns/solid/terms#>.
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

    _:patch a solid:InsertDeletePatch;
      solid:delete {
        # Using canonical form, which Comunica/N3.js might output
        <#me> <http://schema.org/age> "20"^^xsd:integer .
      };
      solid:insert {
        <#me> <http://schema.org/age> 99 .
      }.
    ```

### Expected Behavior
*   The server recognizes that `20` (shorthand) and `"20"^^xsd:integer` are the same RDF term.
*   The triple is deleted.
*   The resource contains only `<#me> <http://schema.org/age> 99 .`.

### Actual Behavior
*   The server returns `200 OK`.
*   The resource now contains **both** values:
    ```turtle
    <#me> <http://schema.org/age> 20, 99 .
    ```

### Investigation Hints
*   Check how N3 Patch parsing handles literals in our CSS version.
*   Check the underlying store's matching logic (is it string-based or RDF-term-based?).
*   If we are using a custom backend, verify how it stores and matches literals.

---

## Issue 2: Concurrent PATCH Requests Cause "SQLITE_ERROR" (500)

**Severity:** Critical (Service Stability)
**Component:** Storage / Locking / SQLite Backend

### Description
When running integration tests that perform rapid sequential or parallel `PATCH` (and sometimes `PUT`) operations against the server, requests fail with `500 Internal Server Error`.

### Error Log
```
InternalServerError: Received unexpected non-HttpError: BEGIN; - SQLITE_ERROR: cannot start a transaction within a transaction
    at ...
    at async SequenceHandler.handle ...
```

### Steps to Reproduce
1.  Run the `drizzle-solid` full test suite (`yarn quality` or `vitest`) which executes multiple tests in parallel.
2.  Tests involve creating containers, inserting data, and updating data (PATCH) in quick succession.

### Expected Behavior
*   The server should queue requests or use proper locking to handle concurrency.
*   If overloaded, return `429` or block until the lock is acquired.
*   Transactions should never overlap incorrectly to cause a crash.

### Actual Behavior
*   Server crashes/errors out with SQLite transaction errors.
*   Data may be left in an inconsistent state.

### Investigation Hints
*   This strongly suggests a race condition in how the server handles resource locking before starting a write transaction.
*   If we modified the storage layer or locking mechanism in our CSS fork, this is the likely culprit.
*   Check if `N3 Patch` handlers properly acquire exclusive locks on the resource *before* attempting to update the store.

---

## Mitigation in `drizzle-solid`
To bypass these issues and ensure stability for `drizzle-solid` users, we have implemented the following in `LdpExecutor`:
1.  **Put-based Fallback:** Updates are performed by reading the full resource, modifying it in memory, and overwriting it using `PUT`. This avoids N3 Patch matching issues.
2.  **Delays:** Added `500ms` delays between operations to reduce the likelihood of triggering the SQLite race condition.
3.  **Robust Formatting:** `formatTerm` now strictly enforces explicit datatype notation to minimize ambiguity, although this alone did not solve Issue 1.
