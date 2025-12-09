# VPS Setup Guide for K3s Nodes

> **Version**: 1.1.0  
> **Last Updated**: 2025-12-09  
> **Status**: Production Ready

This guide covers setting up a production-ready VPS from scratch on Hetzner Cloud (or any provider) to be used as K3s cluster nodes.

---

## Table of Contents

1. [Initial Server Access](#1-initial-server-access)
2. [Create Non-Root User](#2-create-non-root-user)
3. [SSH Hardening](#3-ssh-hardening)
4. [System Updates & Basics](#4-system-updates--basics)
5. [Firewall Configuration](#5-firewall-configuration)
6. [Fail2Ban Setup](#6-fail2ban-setup)
7. [Time Synchronization](#7-time-synchronization)
8. [Docker Installation](#8-docker-installation)
9. [System Hardening](#9-system-hardening)
10. [K3s Installation](#10-k3s-installation)
11. [Monitoring & Logging](#11-monitoring--logging)
12. [Automated Security Updates](#12-automated-security-updates)
13. [Verification Checklist](#13-verification-checklist)

---

## Prerequisites

- Fresh VPS from Hetzner Cloud (Ubuntu 24.04 LTS recommended)
- SSH access to root user
- Local SSH key pair generated

### Recommended Node Sizes

| Node Type  | Hetzner Type | vCPU | RAM  | Use Case                |
| ---------- | ------------ | ---- | ---- | ----------------------- |
| **Master** | CX22         | 2    | 4GB  | K3s control plane       |
| **App**    | CX22         | 2    | 4GB  | Next.js app workloads   |
| **Worker** | CX22         | 2    | 4GB  | Playwright/K6 execution |

---

## 1. Initial Server Access

### Connect as Root

```bash
# First connection - accept host key fingerprint
ssh root@YOUR_SERVER_IP

# Verify you're on the right server
hostname
ip addr show
```

### Set Hostname (Important for K3s)

```bash
# Set a descriptive hostname
hostnamectl set-hostname k3s-worker-us-east-1

# Verify
hostname

# Add to /etc/hosts for local resolution
echo "127.0.1.1 $(hostname)" >> /etc/hosts
```

---

## 2. Create Non-Root User

Never run services as root. Create a dedicated admin user.

```bash
# Create user with home directory
adduser supercheck

# Add to sudo group
usermod -aG sudo supercheck

# Test sudo access
su - supercheck
sudo whoami  # Should output: root
exit
```

### Copy SSH Key to New User

From your **local machine**:

```bash
# Copy your SSH key to the new user
ssh-copy-id supercheck@YOUR_SERVER_IP

# Test login
ssh supercheck@YOUR_SERVER_IP
```

---

## 3. SSH Hardening

### Configure SSH Daemon

```bash
# Backup original config
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Edit SSH config
sudo nano /etc/ssh/sshd_config
```

Apply these settings:

```bash
# Disable root login
PermitRootLogin no

# Disable password authentication (key-only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable empty passwords
PermitEmptyPasswords no

# Disable X11 forwarding (not needed)
X11Forwarding no

# Set login grace time
LoginGraceTime 30

# Limit max auth tries
MaxAuthTries 3

# Disable PAM (using keys only)
UsePAM no

# Only allow specific users
AllowUsers supercheck

# Use strong ciphers only
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr

# Use strong MACs
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256

# Use strong key exchange
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512

# Client alive settings (prevent idle disconnects)
ClientAliveInterval 300
ClientAliveCountMax 2
```

### Handle Cloud-Init Override (Hetzner/AWS/GCP)

```bash
# Check for cloud-init SSH overrides
ls -la /etc/ssh/sshd_config.d/

# If 50-cloud-init.conf exists, disable password auth there too
sudo nano /etc/ssh/sshd_config.d/50-cloud-init.conf
# Set: PasswordAuthentication no
# Or remove the file entirely
```

### Apply Changes

```bash
# Validate config before reloading
sudo sshd -t

# Reload SSH (don't restart - keeps current session)
sudo systemctl reload sshd
```

### Test New Configuration

**Keep your current session open** and test in a new terminal:

```bash
# This should work
ssh supercheck@YOUR_SERVER_IP

# This should fail
ssh root@YOUR_SERVER_IP
```

---

## 4. System Updates & Basics

### Update System

```bash
# Update package lists and upgrade
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  tmux \
  tree \
  jq \
  unzip \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release \
  software-properties-common
```

### Set Timezone

```bash
# Set to UTC for consistency (recommended for servers)
sudo timedatectl set-timezone UTC

# Verify
timedatectl
```

### Configure System Limits

```bash
# Edit limits for production workloads
sudo nano /etc/security/limits.conf
```

Add at the end:

```bash
# Increase file descriptors for Docker/K8s workloads
* soft nofile 65535
* hard nofile 65535
* soft nproc 65535
* hard nproc 65535
root soft nofile 65535
root hard nofile 65535
```

---

## 5. Firewall Configuration

### Install and Configure UFW

```bash
# UFW is usually pre-installed on Ubuntu
sudo apt install -y ufw

# Reset to defaults
sudo ufw --force reset

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# CRITICAL: Allow SSH first!
sudo ufw allow 22/tcp comment 'SSH'

# K3s API server (master nodes only)
sudo ufw allow 6443/tcp comment 'K3s API'

# K3s flannel VXLAN (all nodes)
sudo ufw allow 8472/udp comment 'K3s Flannel VXLAN'

# K3s metrics server
sudo ufw allow 10250/tcp comment 'Kubelet metrics'

# K3s etcd (master nodes only, if HA)
# sudo ufw allow 2379:2380/tcp comment 'etcd'

# HTTP/HTTPS (worker/app nodes with ingress)
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# NodePort range (if using NodePort services)
sudo ufw allow 30000:32767/tcp comment 'K8s NodePort'

# Enable firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

### Docker & UFW Compatibility

> **Warning**: Docker modifies iptables directly, which can bypass UFW rules.

Fix this by configuring Docker to respect UFW:

```bash
# Create Docker daemon config directory
sudo mkdir -p /etc/docker

# Configure Docker to use iptables properly
sudo nano /etc/docker/daemon.json
```

Add:

```json
{
  "iptables": true,
  "ip-forward": true,
  "userland-proxy": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
```

---

## 6. Fail2Ban Setup

Protect against brute-force attacks.

```bash
# Install Fail2Ban
sudo apt install -y fail2ban

# Create local config (don't edit jail.conf directly)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local

# Edit local config
sudo nano /etc/fail2ban/jail.local
```

Configure SSH jail:

```ini
[DEFAULT]
# Ban for 1 hour
bantime = 3600

# 10 minute window
findtime = 600

# 5 failed attempts = ban
maxretry = 5

# Email notifications (optional)
# destemail = your@email.com
# sender = fail2ban@your-server.com
# action = %(action_mwl)s

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
```

```bash
# Start and enable Fail2Ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check status
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

---

## 7. Time Synchronization

Critical for K8s certificate validation and distributed systems.

```bash
# Install chrony (better than ntp for containers)
sudo apt install -y chrony

# Configure chrony
sudo nano /etc/chrony/chrony.conf
```

Add/modify:

```bash
# Use fast, reliable NTP servers
server time.cloudflare.com iburst
server time.google.com iburst
server ntp.ubuntu.com iburst

# Allow faster initial sync
makestep 1 3

# Enable hardware timestamping if available
hwtimestamp *
```

```bash
# Restart chrony
sudo systemctl restart chrony

# Verify sync
chronyc tracking
chronyc sources
```

---

## 8. Docker Installation

Install Docker for K3s container runtime.

```bash
# Remove old versions
sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker supercheck

# Start and enable Docker
sudo systemctl enable docker
sudo systemctl start docker

# Verify installation
docker --version
docker compose version
```

### Configure Docker for Production

```bash
# Apply the daemon.json from earlier if not done
sudo systemctl restart docker

# Verify Docker is running
sudo systemctl status docker
docker info
```

---

## 9. System Hardening

### Disable Unnecessary Services

```bash
# List running services
sudo systemctl list-units --type=service --state=running

# Disable services not needed (examples)
sudo systemctl disable --now snapd.service 2>/dev/null || true
sudo systemctl disable --now snapd.socket 2>/dev/null || true
sudo systemctl disable --now cups.service 2>/dev/null || true
sudo systemctl disable --now avahi-daemon.service 2>/dev/null || true
```

### Kernel Hardening (sysctl)

```bash
# Create hardening config
sudo nano /etc/sysctl.d/99-hardening.conf
```

Add:

```bash
# Network hardening
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Memory and performance
vm.swappiness = 10
vm.dirty_ratio = 60
vm.dirty_background_ratio = 2
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_tw_buckets = 1440000

# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512

# Kubernetes requirements
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
```

```bash
# Apply settings
sudo sysctl --system

# Load bridge module (needed for K8s)
sudo modprobe br_netfilter
echo 'br_netfilter' | sudo tee /etc/modules-load.d/br_netfilter.conf
```

### Disable IPv6 (Optional - If Not Using)

```bash
# If you don't need IPv6
sudo nano /etc/sysctl.d/99-disable-ipv6.conf
```

Add:

```bash
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
```

---

## 10. K3s Installation

### Pre-Installation Checks

```bash
# Verify system requirements
free -h          # Should have 2GB+ RAM for workers
df -h            # Should have 20GB+ disk
nproc            # Check CPU cores

# Check if swap is disabled (required for K8s)
sudo swapoff -a

# Make swap disable permanent
sudo sed -i '/ swap / s/^/#/' /etc/fstab
```

### Install K3s Master Node

For **master nodes**, use standard K3s with containerd (default):

```bash
# First master node (containerd runtime - default)
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --tls-san YOUR_EXTERNAL_IP \
  --tls-san YOUR_DOMAIN \
  --disable traefik \
  --write-kubeconfig-mode 644

# Get the node token (needed for joining workers)
sudo cat /var/lib/rancher/k3s/server/node-token

# Copy kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# Verify installation
kubectl get nodes
kubectl get pods -A
```

### Install K3s Worker Node (With Docker Runtime)

For **worker nodes** running Supercheck workers, use Docker as the container runtime.
This allows workers to mount `/var/run/docker.sock` the same way Docker Compose does.

> **Why Docker runtime for workers?**
> Supercheck workers spawn Playwright and K6 containers. Using Docker runtime on workers
> means workers can use the same Docker socket approach as Docker Compose, providing:
>
> - Shared image cache (images don't re-pull on pod restart)
> - No privileged containers needed (unlike DinD)
> - Same architecture as Docker Compose deployments

```bash
# OPTION A: K3s with Docker Runtime (RECOMMENDED for worker nodes)
# First, ensure Docker is installed (from step 8)
docker --version

# Join as worker with Docker runtime
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_IP:6443 K3S_TOKEN=YOUR_TOKEN sh -s - agent --docker

# Verify Docker is being used
sudo systemctl status k3s-agent
docker ps  # Should show K3s containers
```

```bash
# OPTION B: K3s with containerd + Docker separately (Alternative)
# If you want containerd as K3s runtime but still have Docker available:
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_IP:6443 K3S_TOKEN=YOUR_TOKEN sh -s - agent

# Docker is installed separately - workers will mount /var/run/docker.sock
docker ps  # Docker runs alongside containerd
```

### Verify Worker Configuration

```bash
# On master, check nodes
kubectl get nodes -o wide

# Verify Docker socket exists on worker nodes
ssh worker-node "ls -la /var/run/docker.sock"

# Test Docker from worker pod (after deployment)
kubectl exec -it deploy/supercheck-worker-us -n supercheck -- docker info
```

### Label Nodes

```bash
# On master, label nodes by role
kubectl label nodes k3s-worker-1 workload=worker
kubectl label nodes k3s-worker-1 region=us-east
kubectl label nodes k3s-app-1 workload=app

# Add taints for worker nodes (optional)
kubectl taint nodes k3s-worker-1 workload=worker:NoSchedule
```

---

## 11. Monitoring & Logging

### Install Node Exporter (For Prometheus)

```bash
# Create system user
sudo useradd --no-create-home --shell /bin/false node_exporter

# Download and install
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar xzf node_exporter-1.7.0.linux-amd64.tar.gz
sudo cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/
sudo chown node_exporter:node_exporter /usr/local/bin/node_exporter

# Create systemd service
sudo nano /etc/systemd/system/node_exporter.service
```

Add:

```ini
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter

# Verify
curl localhost:9100/metrics | head
```

### Configure Log Rotation

```bash
# Docker logs are already configured in daemon.json
# Configure system logs
sudo nano /etc/logrotate.d/syslog
```

Ensure these settings:

```bash
/var/log/syslog
/var/log/auth.log
{
    rotate 7
    daily
    missingok
    notifempty
    delaycompress
    compress
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
```

---

## 12. Automated Security Updates

### Enable Unattended Upgrades

```bash
# Install unattended-upgrades
sudo apt install -y unattended-upgrades apt-listchanges

# Configure
sudo dpkg-reconfigure -plow unattended-upgrades

# Edit config
sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
```

Key settings:

```bash
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

// Auto-remove unused packages
Unattended-Upgrade::Remove-Unused-Dependencies "true";

// Auto-reboot if needed (with caution for K8s nodes)
// Unattended-Upgrade::Automatic-Reboot "true";
// Unattended-Upgrade::Automatic-Reboot-Time "02:00";
```

```bash
# Enable auto-updates
sudo nano /etc/apt/apt.conf.d/20auto-upgrades
```

Add:

```bash
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
```

---

## 13. Verification Checklist

Run through this checklist to verify your setup:

```bash
#!/bin/bash
# save as verify-setup.sh

echo "=== VPS Security Verification ==="

echo -e "\n1. SSH Configuration"
echo "Root login disabled:"
grep "^PermitRootLogin" /etc/ssh/sshd_config
echo "Password auth disabled:"
grep "^PasswordAuthentication" /etc/ssh/sshd_config

echo -e "\n2. Firewall Status"
sudo ufw status verbose

echo -e "\n3. Fail2Ban Status"
sudo fail2ban-client status sshd

echo -e "\n4. System Updates"
echo "Packages needing update:"
apt list --upgradable 2>/dev/null | wc -l

echo -e "\n5. Time Sync"
chronyc tracking | grep "System time"

echo -e "\n6. Docker Status"
docker info | grep "Server Version"

echo -e "\n7. K3s Status"
kubectl get nodes 2>/dev/null || echo "K3s not installed or not configured"

echo -e "\n8. Open Ports"
sudo ss -tlnp | grep LISTEN

echo -e "\n9. Running Services"
systemctl list-units --type=service --state=running | wc -l

echo -e "\n10. Disk Usage"
df -h /

echo -e "\n=== Verification Complete ==="
```

```bash
# Make executable and run
chmod +x verify-setup.sh
./verify-setup.sh
```

---

## Quick Setup Script

For faster setup, here's a condensed script (review before running!):

```bash
#!/bin/bash
# quick-setup.sh - Run as root on fresh Ubuntu 24.04

set -e

# Variables
NEW_USER="supercheck"
SSH_PORT="22"

# Update system
apt update && apt upgrade -y

# Create user
adduser --disabled-password --gecos "" $NEW_USER
usermod -aG sudo $NEW_USER
echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$NEW_USER

# Copy SSH keys
mkdir -p /home/$NEW_USER/.ssh
cp /root/.ssh/authorized_keys /home/$NEW_USER/.ssh/
chown -R $NEW_USER:$NEW_USER /home/$NEW_USER/.ssh
chmod 700 /home/$NEW_USER/.ssh
chmod 600 /home/$NEW_USER/.ssh/authorized_keys

# Harden SSH
cat > /etc/ssh/sshd_config.d/hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
AllowUsers $NEW_USER
EOF
systemctl reload sshd

# Install packages
apt install -y ufw fail2ban chrony curl wget git htop tmux jq

# Configure firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow $SSH_PORT/tcp
ufw allow 6443/tcp
ufw allow 8472/udp
ufw allow 10250/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Configure fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Disable swap
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $NEW_USER

echo "Setup complete! Reboot recommended."
echo "Login as: ssh $NEW_USER@$(curl -s ifconfig.me)"
```

---

## Related Documentation

- [Kubernetes Guide](./KUBERNETES_GUIDE.md) - K8s deployment guide
- [Terraform Guide](./TERRAFORM_GUIDE.md) - Infrastructure as code
- [Node Setup](./NODE_SETUP.md) - K8s node labeling
- [Scaling Guide](./SCALING_GUIDE.md) - Scaling strategies
