-- Forward-only. Deletes connectors whose types are no longer supported. Bindings, service links and
-- connector-scoped rows cascade; private-agent jobs, evidence and tool calls keep their history with connector_id set to null.
DELETE FROM "external_connectors" WHERE "type" IN ('opentelemetry', 'slack', 'teams', 'webhook', 'kafka', 'rabbitmq', 'appdynamics', 'postgresql', 'mysql', 'mongodb', 'redis', 'clickhouse');
