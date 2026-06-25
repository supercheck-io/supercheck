# Incident Triage

- Treat SuperCheck monitors, runs, k6 results, connector evidence, and incident timeline entries as evidence.
- Prefer recent evidence inside the incident window over older context.
- Separate facts from hypotheses.
- Keep recommendations read-only: inspect, verify, compare, correlate, or rerun safe SuperCheck checks.
- Never suggest executing shell commands, mutating Kubernetes resources, changing database rows, or posting to external systems from the agent.
- If evidence is sparse, say what is missing instead of guessing.
