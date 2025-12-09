#!/bin/bash
# Supercheck K3s Master Node Setup Script (Hetzner vSwitch Edition)
# Run this script on the master node
#
# Usage: ./setup-master.sh [OPTIONS]
#   --private-ip IP    Private IP on vSwitch network (required)
#   --public-ip IP     Public IP of this node (required)
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
PRIVATE_IP=""
PUBLIC_IP=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --private-ip)
      PRIVATE_IP="$2"
      shift 2
      ;;
    --public-ip)
      PUBLIC_IP="$2"
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

# Auto-detect IPs if not provided
if [[ -z "$PRIVATE_IP" ]]; then
  # Try to get private IP from eth0 (Hetzner vSwitch)
  PRIVATE_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1 || echo "")
  if [[ -z "$PRIVATE_IP" ]]; then
    error "Could not detect private IP. Use --private-ip 10.x.x.x"
  fi
  log "Auto-detected private IP: $PRIVATE_IP"
fi

if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP=$(curl -s ifconfig.me || echo "")
  if [[ -z "$PUBLIC_IP" ]]; then
    error "Could not detect public IP. Use --public-ip YOUR_IP"
  fi
  log "Auto-detected public IP: $PUBLIC_IP"
fi

log "Setting up K3s Master Node"
log "  Private IP (vSwitch): $PRIVATE_IP"
log "  Public IP: $PUBLIC_IP"

# Set hostname
log "Setting hostname to k3s-master..."
hostnamectl set-hostname k3s-master
echo "127.0.1.1 k3s-master" >> /etc/hosts

# Check if K3s is already installed
if command -v k3s &> /dev/null; then
  warn "K3s already installed. Skipping installation."
else
  log "Installing K3s server..."
  curl -sfL https://get.k3s.io | sh -s - server \
    --cluster-init \
    --tls-san "$PRIVATE_IP" \
    --tls-san "$PUBLIC_IP" \
    --tls-san app.supercheck.io \
    --disable traefik \
    --disable servicelb \
    --node-ip "$PRIVATE_IP" \
    --flannel-iface eth0 \
    --write-kubeconfig-mode 644
fi

# Wait for K3s to be ready
log "Waiting for K3s to be ready..."
sleep 10
k3s kubectl wait --for=condition=Ready nodes --all --timeout=120s

# Setup kubeconfig
log "Setting up kubeconfig..."
mkdir -p ~/.kube
cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
chown "$(id -u):$(id -g)" ~/.kube/config 2>/dev/null || true

# Get node token
NODE_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token)

# Install NGINX Ingress Controller
log "Installing NGINX Ingress Controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.0/deploy/static/provider/baremetal/deploy.yaml

# Install cert-manager
log "Installing cert-manager..."
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Install KEDA
log "Installing KEDA..."
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml

log ""
log "=========================================="
log "${GREEN}K3s Master Node Setup Complete!${NC}"
log "=========================================="
log ""
log "Node Token (save this for worker nodes):"
echo ""
echo "$NODE_TOKEN"
echo ""
log "Kubeconfig: ~/.kube/config"
log ""
log "To add worker nodes, run on each worker:"
log "  ./setup-worker.sh --master-ip $PRIVATE_IP --token '<TOKEN>' --region <REGION>"
log ""
log "Regions: us-east, eu-central, asia-pacific"
log ""
log "Verify cluster:"
log "  kubectl get nodes"
