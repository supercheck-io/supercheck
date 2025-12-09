#!/bin/bash
# Supercheck K3s Worker Node Setup Script (Hetzner vSwitch Edition)
# Run this script on worker nodes in any region
#
# Usage: ./setup-worker.sh [OPTIONS]
#   --master-ip IP     Private IP of master node on vSwitch (required)
#   --token TOKEN      K3s node token from master (required)
#   --region REGION    Worker region: us-east, eu-central, asia-pacific (required)
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
REGION=""

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
    --region)
      REGION="$2"
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

if [[ -z "$REGION" ]]; then
  error "Region is required. Use --region us-east|eu-central|asia-pacific"
fi

# Validate region
case $REGION in
  us-east|eu-central|asia-pacific)
    ;;
  *)
    error "Invalid region: $REGION. Use: us-east, eu-central, or asia-pacific"
    ;;
esac

# Get private IP
PRIVATE_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1 || echo "")
if [[ -z "$PRIVATE_IP" ]]; then
  error "Could not detect private IP on vSwitch. Is eth0 connected to the network?"
fi

# Short hostname based on region
case $REGION in
  us-east)
    HOSTNAME_SHORT="k3s-worker-us"
    ;;
  eu-central)
    HOSTNAME_SHORT="k3s-worker-eu"
    ;;
  asia-pacific)
    HOSTNAME_SHORT="k3s-worker-apac"
    ;;
esac

log "Setting up K3s Worker Node"
log "  Master IP: $MASTER_IP"
log "  Private IP: $PRIVATE_IP"
log "  Region: $REGION"

# Set hostname
log "Setting hostname to $HOSTNAME_SHORT..."
hostnamectl set-hostname "$HOSTNAME_SHORT"
echo "127.0.1.1 $HOSTNAME_SHORT" >> /etc/hosts

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  
  # Configure Docker
  log "Configuring Docker..."
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF
  systemctl restart docker
else
  log "Docker already installed."
fi

# Check if K3s is already installed
if command -v k3s &> /dev/null; then
  warn "K3s already installed. Skipping installation."
else
  log "Installing K3s agent with Docker runtime..."
  curl -sfL https://get.k3s.io | K3S_URL="https://$MASTER_IP:6443" \
    K3S_TOKEN="$TOKEN" sh -s - agent \
    --docker \
    --node-ip "$PRIVATE_IP" \
    --flannel-iface eth0
fi

# Wait for node to register
log "Waiting for node to register..."
sleep 10

log ""
log "=========================================="
log "${GREEN}K3s Worker Node Setup Complete!${NC}"
log "=========================================="
log ""
log "On the master node, run these commands to label this node:"
log ""
echo "  kubectl label nodes $HOSTNAME_SHORT workload=worker region=$REGION"
echo "  kubectl taint nodes $HOSTNAME_SHORT workload=worker:NoSchedule"
log ""
log "Verify Docker is working:"
log "  docker info"
log ""
log "Check node status from master:"
log "  kubectl get nodes"
