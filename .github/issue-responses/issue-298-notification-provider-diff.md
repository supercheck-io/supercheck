Hi @pausauer, thanks for the detailed reproduction.

We fixed this in the CLI reconciliation path.

Root cause: `notificationProviders` were present in the CLI config schema, but they were not included in the resource list used by `supercheck pull`, `supercheck diff`, and `supercheck deploy`. Because the provider was never reconciled as a managed resource, nested config changes such as `config.bodyTemplate` were ignored and diff reported no changes.

Fixed behavior:

- `supercheck pull` now exports notification providers into `supercheck.config.ts`.
- `supercheck diff` now compares notification providers, including nested `config` fields such as `bodyTemplate`.
- `supercheck deploy` now creates/updates/deletes notification providers through `/api/notification-providers`.
- The server-side notification provider update path was also hardened to preserve existing fields during partial updates and keep writes tenant-scoped.

Safe secret handling:

- The server API continues to return non-secret template fields such as `bodyTemplate`; secret fields remain masked for safety.
- `supercheck pull` strips masked secret fields from the written config instead of writing placeholder values, so pulled configs are safe to commit.
- `supercheck deploy` preserves existing secret values for any sensitive fields omitted from the config, so non-secret edits (for example, `bodyTemplate` changes) round-trip safely without overwriting real webhook URLs.
- The CLI ignores omitted masked secret fields during diff to avoid false changes, while still comparing non-secret fields like `bodyTemplate`. If you add a new secret value locally for rotation, diff reports a redacted secret change and deploy sends the new value.

If you need to rotate a secret, add the new value to the config file before deploying, or use `supercheck notification update --config` with the full replacement config. Regression tests now cover webhook `bodyTemplate` drift, redacted secret rotation diffs, and the secret-preserving merge behavior.
