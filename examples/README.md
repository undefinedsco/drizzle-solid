# Drizzle Solid Examples

This folder hosts the canonical end-to-end walkthroughs referenced in the docs. Each script assumes you have installed dependencies (`npm install`) and configured credentials via environment variables.

## Example lineup
- `01-server-setup.ts`: boots a local Community Solid Server instance and seeds demo accounts.
- `02-authentication.ts`: demonstrates Client Credentials login with `@inrupt/solid-client-authn-node` and verifies the session state.
- `03-basic-usage.ts`: connects Drizzle to a Solid Pod, creates a demo table, and exercises simple CRUD queries.

See `examples/archive/` for experimental or legacy demos that may require manual tweaks.

## Running
```bash
npm run example:setup      # launches CSS and seeds pods
npm run example:auth       # runs 02-authentication.ts
npm run example:usage      # runs 03-basic-usage.ts
```

Make sure `npm run server:start` (Community Solid Server) is running in another terminal before invoking the authentication or usage flows.
