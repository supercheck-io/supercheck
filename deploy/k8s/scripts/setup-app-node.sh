#!/bin/bash
# Supercheck K3s App Node Setup Script (Hetzner vSwitch Edition)
# Run this script on app nodes (optional - for HA app deployment)
#
# Usage: ./setup-app-node.sh [OPTIONS]
#   --master-ip IP     Private IP of master node on vSwitch (required)
#   --token TOKEN      K3s node token from master (required)
#   --help             Show this help message
#
# Prerequisites:
#   - Ubuntu 22.04/24.04 LTS
#   - Attached to Hetzner vSwitch network
#   - Root or sudo access

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Default values
MASTER_IP=""
TOKEN=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --master-ip)
      MASTER_IP="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    --help)
      head -15 "$0" | tail -10
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      ;;
  esac
done

# Validate inputs
if [[ -z "$MASTER_IP" ]]; then
  error "Master IP is required. Use --master-ip 10.0.1.10"
fi

if [[ -z "$TOKEN" ]]; then
  error "Node token is required. Use --token YOUR_TOKEN"
fi

# Get private IP
PRIVATE_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1 || echo "")
if [[ -z "$PRIVATE_IP" ]]; then
  error "Could not detect private IP on vSwitch."
fi

HOSTNAME_SHORT="k3s-app"

log "Setting up K3s App Node"
log "  Master IP: $MASTER_IP"
log "  Private IP: $PRIVATE_IP"

# Set hostname
log "Setting hostname to $HOSTNAME_SHORT..."
hostnamectl set-hostname "$HOSTNAME_SHORT"
echo "127.0.1.1 $HOSTNAME_SHORT" >> /etc/hosts

# Check if K3s is already installed
if command -v k3s &> /dev/null; then
  warn "K3s already installed. Skipping installation."
else
  log "Installing K3s agent..."
  # App nodes don't need Docker (they run Next.js, not container spawning)
  curl -sfL https://get.k3s.io | K3S_URL="https://$MASTER_IP:6443" \
    K3S_TOKEN="$TOKEN" sh -s - agent \
    --node-ip "$PRIVATE_IP" \
    --flannel-iface eth0
fi

# Wait for node to register
log "Waiting for node to register..."
sleep 10

log ""
log "=========================================="
log "${GREEN}K3s App Node Setup Complete!${NC}"
log "=========================================="
log ""
log "On the master node, run this command to label this node:"
log ""
echo "  kubectl label nodes $HOSTNAME_SHORT workload=app"
log ""
log "Check node status from master:"
log "  kubectl get nodes"
