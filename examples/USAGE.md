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
- `yarn example:auth` – runs `02-authentication.ts` to verify login and token metadata.
- `yarn example:usage` – executes `03-basic-usage.ts` for CRUD coverage.

Troubleshooting tips live in `docs/quick-start-local.md`; reference it if CSS fails to start or authentication is rejected.
