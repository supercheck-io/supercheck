#!/bin/bash
# Supercheck Self-Hosted Setup Script
# Generates secure secrets and prepares environment for first run
#
# Usage:
#   ./init-secrets.sh              # Create .env with auto-generated secrets
#   ./init-secrets.sh --force      # Overwrite existing .env file

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║            Supercheck Self-Hosted Setup                       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env already exists
if [ -f "$ENV_FILE" ] && [ "$1" != "--force" ]; then
    echo -e "${YELLOW}⚠️  .env file already exists at: ${ENV_FILE}${NC}"
    echo -e "   Use ${GREEN}./init-secrets.sh --force${NC} to regenerate"
    echo ""
    exit 0
fi

# Generate secure random secrets
generate_secret() {
    openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p | head -c $(($1 * 2))
}

echo -e "${GREEN}🔐 Generating secure secrets...${NC}"

BETTER_AUTH_SECRET=$(generate_secret 16)
SECRET_ENCRYPTION_KEY=$(generate_secret 16)
DB_PASSWORD=$(generate_secret 16)
REDIS_PASSWORD=$(generate_secret 16)
MINIO_ACCESS_KEY=$(generate_secret 16)
MINIO_SECRET_KEY=$(generate_secret 32)

# Create .env file
cat > "$ENV_FILE" << EOF
# ============================================================
# Supercheck Self-Hosted Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================

# ------------------------------------------------------------
# REQUIRED: OAuth Provider (at least one)
# ------------------------------------------------------------
# GitHub OAuth (https://github.com/settings/developers)
# - Homepage URL: http://localhost:3000 (or your domain)
# - Callback URL: http://localhost:3000/api/auth/callback/github
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth (https://console.cloud.google.com/apis/credentials)
# - Redirect URI: http://localhost:3000/api/auth/callback/google
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# ------------------------------------------------------------
# OPTIONAL: Domain Configuration (for HTTPS deployment)
# ------------------------------------------------------------
# Uncomment and set these for production with domain
# APP_DOMAIN=app.yourdomain.com
# ACME_EMAIL=admin@yourdomain.com

# ------------------------------------------------------------
# AUTO-GENERATED: Security Secrets (do not change)
# ------------------------------------------------------------
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
SECRET_ENCRYPTION_KEY=${SECRET_ENCRYPTION_KEY}
DB_PASSWORD=${DB_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}

# Updated Redis URL with new password
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@postgres:5432/supercheck

# MinIO/S3 Credentials (auto-generated)
AWS_ACCESS_KEY_ID=${MINIO_ACCESS_KEY}
AWS_SECRET_ACCESS_KEY=${MINIO_SECRET_KEY}

# ------------------------------------------------------------
# OPTIONAL: Email Notifications (SMTP)
# ------------------------------------------------------------
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASSWORD=your-app-password
# SMTP_FROM_EMAIL=notifications@yourdomain.com

# ------------------------------------------------------------
# OPTIONAL: AI Features (OpenAI)
# ------------------------------------------------------------
# OPENAI_API_KEY=sk-your-api-key
# AI_MODEL=gpt-4o-mini

# ------------------------------------------------------------
# OPTIONAL: Worker Scaling
# ------------------------------------------------------------
# WORKER_REPLICAS=1
# RUNNING_CAPACITY=1
EOF

echo -e "${GREEN}✅ Created .env file at: ${ENV_FILE}${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo ""
echo -e "   1. Configure OAuth (required):"
echo -e "      ${BLUE}nano .env${NC}"
echo -e "      Add your GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"
echo ""
echo -e "   2. Start Supercheck:"
echo -e "      ${BLUE}docker compose up -d${NC}"
echo ""
echo -e "   3. Access at:"
echo -e "      ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
