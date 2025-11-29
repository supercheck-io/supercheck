#!/bin/bash
set -e

# Wait for network
sleep 5

# Update system
apt-get update
apt-get upgrade -y
apt-get install -y curl wget vim htop

# Install Docker (critical for container execution)
curl https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker ubuntu
rm get-docker.sh

# Start Docker daemon
systemctl start docker
systemctl enable docker

# Install K3s agent/worker
export INSTALL_K3S_VERSION="${k3s_version}"
curl -sfL https://get.k3s.io | K3S_URL='${k3s_server_url}' K3S_TOKEN='${k3s_token}' sh -

# Label this node as worker
# Note: Labeling usually happens from master or via kubelet args. 
# Here we just ensure agent is running. Labeling might need to be done from master or via extra args.
# For simplicity in this script, we'll assume the node registers and we can label it later or via args.
# Adding node-label arg to installation:
# curl -sfL https://get.k3s.io | K3S_URL='${k3s_server_url}' K3S_TOKEN='${k3s_token}' sh -s - --node-label workload=worker

echo "K3s worker setup complete"
