#!/bin/bash
set -e

# Wait for network
sleep 5

# Update system
apt-get update
apt-get upgrade -y
apt-get install -y curl wget vim htop

# Install Docker
curl https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker ubuntu
rm get-docker.sh

# Install K3s master
export INSTALL_K3S_VERSION="${k3s_version}"

# HA Setup:
# First node: curl ... | sh -s - server --cluster-init --tls-san <LB_IP>
# Other nodes: curl ... | sh -s - server --server https://<FIRST_NODE_IP>:6443 --tls-san <LB_IP>

curl -sfL https://get.k3s.io | K3S_URL='' K3S_TOKEN='${node_token}' sh -s - server \
  ${cluster_init} \
  --tls-san ${lb_api_ip} \
  --node-label workload=app \
  --disable traefik \
  --disable servicelb

# Wait for K3s to be ready
while ! kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml get nodes &>/dev/null; do
  echo "Waiting for K3s to be ready..."
  sleep 5
done

# Copy kubeconfig for retrieval
cp /etc/rancher/k3s/k3s.yaml /root/.kube/config
chmod 644 /root/.kube/config

echo "K3s master setup complete"
