# Usage Notes

## Local CSS Setup
1. Install dependencies: `yarn install`
2. Seed demo accounts once: `yarn server:setup`
3. Keep the server running: `yarn server:start`

## Environment
Export Solid credentials before running examples:
```bash
export SOLID_CLIENT_ID="your-client-id"
export SOLID_CLIENT_SECRET="your-client-secret"
export SOLID_OIDC_ISSUER="http://localhost:3000"
```

## Scripts
- `yarn example:setup` – bootstraps CSS and seeded pods (idempotent).
- `yarn example:quick` – executes `examples/01-quick-start.ts` for CRUD coverage.
- `yarn example:query` – executes `examples/02-relational-query.ts`.
- `yarn example:discovery` / `yarn example:data-discovery` – executes `examples/05-data-discovery.ts`.
- `yarn example:notifications` – executes `examples/04-notifications.ts`.
- `yarn example:federated` – executes `examples/06-federated-query.ts`.
- `yarn example:hooks` – executes `examples/07-hooks-and-profile.ts`.
- `yarn example:iri` – executes `examples/08-iri-based-operations.ts`.
- `yarn example:schema-inheritance` – executes `examples/08-schema-inheritance.ts`.
- `yarn example:templates` – executes `examples/09-multi-variable-templates.ts`.
- `yarn examples:check` – validates `examples/manifest.json` and script/doc/test links.

Troubleshooting tips live in `docs/quick-start-local.md`; reference it if CSS fails to start or authentication is rejected.
