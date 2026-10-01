# Build from the repository root: docker build -f docs/Dockerfile .
FROM node:22-bullseye-slim AS builder
WORKDIR /app/docs
COPY docs/package.json docs/package-lock.json ./
COPY docs/next.config.mjs docs/source.config.ts ./
RUN npm ci --silent
COPY docs/ ./
COPY app/public/openapi.json /app/app/public/openapi.json
RUN npm run build -- --webpack

# Next.js exports this site as static files; next start cannot serve it.
FROM nginx:stable-alpine AS runner
COPY docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/docs/out /usr/share/nginx/html
EXPOSE 3000
