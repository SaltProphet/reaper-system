# Contributing

## Development workflow

1. Create a focused branch from `main`.
2. Install the locked dependencies with `npm ci`.
3. Keep provider and database credentials in your environment, never in commits.
4. Make the smallest coherent change that satisfies the workflow contract.
5. Run the quality checks before opening a pull request:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build:dev
   ```

## Runtime changes

- Register executor implementations in `src/lib/runtime/registry.ts`.
- Declare named input and output ports with matching value types.
- Keep external provider access in server-only modules.
- Test routing, nested returns, failure behavior, retry classification, citation validation, and call caps.
- Preserve the depth limit, step budget, and optimistic version checks unless the change explicitly revises those contracts.

## Authentication and persistence

- Every server function that accesses user data must use `authMiddleware`.
- Scope every workflow and run query to the verified `context.userId`; never accept an owner ID from client input.
- Add schema changes as ordered, additive migration files in `migrations/`.
- Do not edit migrations that may already have been applied.
- Do not import browser demonstration evidence into durable run history.

## Pull requests

Describe what changed, how it was tested, any migration or provider-cost impact, and the deployment configuration required.
