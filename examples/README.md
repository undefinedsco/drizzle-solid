# Drizzle Solid Examples

This folder hosts the canonical end-to-end walkthroughs referenced in the docs. Each script assumes you have installed dependencies (`yarn install`) and configured credentials via environment variables.

## Example lineup
- `01-server-setup.ts`: boots a local Community Solid Server instance and seeds demo accounts.
- `02-authentication.ts`: demonstrates Client Credentials login with `@inrupt/solid-client-authn-node` and verifies the session state.
- `03-basic-usage.ts`: connects Drizzle to a Solid Pod, creates a demo table, and exercises simple CRUD queries.
- `04-sai-chat.ts`: demonstrates how to build a "Zero-Config" Cross-Pod Chat application using SAI (Solid Application Interoperability) Discovery. It shows how one user (Bob) can discover and interact with data shared by another user (Alice) without knowing the data's URL beforehand.
- SPARQL endpoint mode: if you have a dedicated SPARQL service, create a table with `accessMode: 'sparql'` and `sparqlEndpoint: 'https://your-endpoint/sparql'` (no need to supply a base container). CRUD will go directly to the endpoint instead of LDP PATCH/PUT.

See `examples/archive/` for experimental or legacy demos that may require manual tweaks.

## Running
```bash
yarn example:setup      # launches CSS and seeds pods
yarn example:auth       # runs 02-authentication.ts
yarn example:usage      # runs 03-basic-usage.ts
```

Make sure `yarn server:start` (Community Solid Server) is running in another terminal before invoking the authentication or usage flows.
