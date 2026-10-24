## Summary

Describe the user-visible and runtime changes.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build:dev`
- [ ] Relevant browser behavior was checked

## Runtime impact

- [ ] No new credential is exposed to the client
- [ ] Server reads and writes remain scoped to the verified user
- [ ] Provider call limits and retry behavior remain explicit
- [ ] Migrations are additive; applied migrations are not edited
