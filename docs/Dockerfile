# Multi-stage Dockerfile for running the Next.js docs site (supports API routes)
# Build stage
FROM node:20-bullseye-slim AS builder

WORKDIR /app

# Copy only package files to leverage layer caching
COPY package.json package-lock.json* ./

# Install dependencies for the docs subfolder
WORKDIR /app/docs
RUN npm ci --silent

# Copy the repo contents and build the docs app
WORKDIR /app
COPY . .
WORKDIR /app/docs
RUN npm run build

# Production stage
FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy only what we need from the builder
COPY --from=builder /app/docs/.next ./.next
COPY --from=builder /app/docs/public ./public
COPY --from=builder /app/docs/node_modules ./node_modules
COPY --from=builder /app/docs/package.json ./package.json

EXPOSE 3000

# Start the Next.js production server
CMD ["npm", "start"]
