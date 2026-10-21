# Build from the repository root: docker build -f docs/Dockerfile .
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS builder
WORKDIR /app/docs
COPY docs/package.json docs/package-lock.json ./
COPY docs/next.config.mjs docs/source.config.ts ./
RUN npm ci --silent
COPY docs/ ./
COPY app/public/openapi.json /app/app/public/openapi.json
COPY app/src/lib/billing/plan-catalog.json /app/app/src/lib/billing/plan-catalog.json
RUN npm run build -- --webpack

# Next.js exports this site as static files; next start cannot serve it.
FROM nginx:stable-alpine AS runner
COPY docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/docs/out /usr/share/nginx/html
EXPOSE 3000
