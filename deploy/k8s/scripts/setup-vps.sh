#!/bin/bash
# Supercheck VPS Base Setup Script (Hetzner Edition)
# Run this script FIRST on ALL nodes before K3s installation
#
# Usage: ./setup-vps.sh
#
# This script:
#   - Updates system packages
#   - Installs essential tools
#   - Configures firewall
#   - Hardens SSH
#   - Optimizes system settings for Kubernetes

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (use sudo)"
fi

log "Starting VPS Base Setup..."

# Update system
log "Updating system packages..."
apt update && apt upgrade -y

# Install essential packages
log "Installing essential packages..."
apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  tmux \
  jq \
  unzip \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release \
  software-properties-common \
  fail2ban \
  ufw

# Configure firewall
log "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp comment 'SSH'

# K3s ports
ufw allow 6443/tcp comment 'K3s API'

# HTTP/HTTPS (for ingress on master)
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# NodePort range
ufw allow 30000:32767/tcp comment 'K8s NodePort'

# Enable firewall
ufw --force enable

# Configure kernel parameters for Kubernetes
log "Configuring kernel parameters..."
cat > /etc/sysctl.d/99-kubernetes.conf <<EOF
# Enable IP forwarding
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# Network hardening
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1

# Memory and performance
vm.swappiness = 10
net.core.somaxconn = 65535

# File limits
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512

# Required for Kubernetes
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF

# Load bridge module
modprobe br_netfilter
echo 'br_netfilter' > /etc/modules-load.d/br_netfilter.conf

# Apply sysctl
sysctl --system

# Configure file limits
log "Configuring file limits..."
cat >> /etc/security/limits.conf <<EOF
* soft nofile 65535
* hard nofile 65535
* soft nproc 65535
* hard nproc 65535
EOF

# Disable swap (required for Kubernetes)
log "Disabling swap..."
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Set timezone to UTC
log "Setting timezone to UTC..."
timedatectl set-timezone UTC

# Configure Fail2Ban
log "Configuring Fail2Ban..."
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban

log ""
log "=========================================="
log "${GREEN}VPS Base Setup Complete!${NC}"
log "=========================================="
log ""
log "This node is configured for Hetzner vSwitch networking."
log ""
log "Next steps depend on where this node is provisioned:"
log ""
log "  If using Terraform:"
log "    - Nodes are auto-configured via cloud-init"
log ""
log "  If manual setup:"
log "    - Master: ./setup-master.sh --private-ip 10.0.1.10"
log "    - Worker: ./setup-worker.sh --master-ip 10.0.1.10 --token TOKEN --region us-east"
log ""
log "Firewall status:"
ufw status numbered
