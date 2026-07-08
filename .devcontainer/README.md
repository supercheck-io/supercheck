# Dev Container Local Development

This optional VS Code Dev Container provides a fully configured source-code development environment that runs on Linux, remote VPS hosts, or GitHub Codespaces without changing your local machine. It is not part of the core product deployment path; use the main deployment docs for production or self-hosted runtime setup.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [VS Code](https://code.visualstudio.com/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## Getting Started

1. Open this repository in VS Code.
2. Press `F1` and run **Dev Containers: Reopen in Container**.
3. Wait for the image to build and dependencies to install automatically.
4. Set up environment variables:

   ```bash
   cp app/.env.example app/.env
   cp worker/.env.example worker/.env
   ```

5. Start supporting services (PostgreSQL, Redis, MinIO):

   ```bash
   docker compose -f deploy/docker/docker-compose-local.yml up -d postgres redis minio
   ```

6. Run the Next.js app and NestJS worker in separate VS Code terminals:

   ```bash
   # Terminal 1
   cd app && npm run dev

   # Terminal 2
   cd worker && npm run dev
   ```

## Running Tests

- **Linting:** `npm run lint` inside `app/` or `worker/`
- **Unit tests:** `npm test` inside `app/` or `worker/`
- **E2E / Playwright:** `npm run e2e` inside `app/`
- **k6:** available globally inside the container

## Rebuilding and Limitations

- If you modify `.devcontainer/devcontainer.json` or `.devcontainer/Dockerfile`, rebuild by pressing `F1` and running **Dev Containers: Rebuild Container**.
- Local gVisor/K3s execution testing may be limited inside the container because the Dev Container focuses on source-code development rather than nested Kubernetes execution.
