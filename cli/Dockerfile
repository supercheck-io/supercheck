# Supercheck CLI Docker Image
# Usage:
#   docker build -t supercheck/cli .
#   docker run --rm -e SUPERCHECK_TOKEN=$TOKEN supercheck/cli job trigger <id> --wait

FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsup.config.ts ./
COPY src/ src/

RUN npm run build

# --- Production image ---
FROM node:20-slim

LABEL org.opencontainers.image.title="Supercheck CLI"
LABEL org.opencontainers.image.description="CLI for Supercheck test automation and monitoring"
LABEL org.opencontainers.image.source="https://github.com/supercheck-io/supercheck"
LABEL org.opencontainers.image.vendor="Supercheck"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r supercheck && useradd -r -g supercheck -m supercheck

WORKDIR /app

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/ node_modules/

RUN ln -s /app/dist/bin/supercheck.js /usr/local/bin/supercheck \
  && chmod +x /app/dist/bin/supercheck.js

USER supercheck

ENTRYPOINT ["supercheck"]
CMD ["--help"]
