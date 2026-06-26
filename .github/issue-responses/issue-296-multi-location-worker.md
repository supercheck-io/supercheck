Hi @jonathanmarsaud, thanks for the detailed logs.

We found the root cause: the remote worker compose file did not set `SELF_HOSTED=true`. Without that flag, the worker treated the database as a cloud PostgreSQL target and required SSL. That causes every database query to fail when the remote worker connects to the bundled self-hosted Postgres instance.

Fixed changes:

- Remote worker compose now defaults `SELF_HOSTED=true`.
- Worker Docker healthchecks now use `/health/ready`, so database/Redis/queue problems make worker containers unhealthy immediately instead of allowing jobs to start and fail later.
- The multi-location deployment docs now include `SELF_HOSTED=true` in remote worker examples and troubleshooting.

For existing remote workers, add this to the remote worker `.env` and restart the worker:

```bash
SELF_HOSTED=true
docker compose -f docker-compose-worker.yml up -d
```

After restart, the worker should process monitor jobs for its configured `WORKER_LOCATION`.
