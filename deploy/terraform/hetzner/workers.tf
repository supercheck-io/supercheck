# K3s Worker Nodes (Multi-Region)

# -----------------------------------------------------------------------------
# Cloud-init Template for Worker Nodes
# -----------------------------------------------------------------------------
locals {
  worker_cloud_init = <<-EOF
    #cloud-config
    package_update: true
    package_upgrade: true
    
    packages:
      - curl
      - wget
      - jq
      - htop
      - fail2ban
      - docker.io

    write_files:
      - path: /etc/sysctl.d/99-kubernetes.conf
        content: |
          net.ipv4.ip_forward = 1
          net.bridge.bridge-nf-call-iptables = 1
          net.bridge.bridge-nf-call-ip6tables = 1
          fs.inotify.max_user_watches = 524288
          fs.inotify.max_user_instances = 512

      - path: /etc/docker/daemon.json
        content: |
          {
            "log-driver": "json-file",
            "log-opts": {
              "max-size": "10m",
              "max-file": "3"
            },
            "storage-driver": "overlay2",
            "live-restore": true
          }
        
    runcmd:
      # Load bridge module
      - modprobe br_netfilter
      - echo 'br_netfilter' > /etc/modules-load.d/br_netfilter.conf
      - sysctl --system
      
      # Disable swap
      - swapoff -a
      - sed -i '/ swap / s/^/#/' /etc/fstab
      
      # Enable Docker
      - systemctl enable docker
      - systemctl start docker
      
      # Wait for master to be ready
      - sleep 60
      
      # Get join token from master via SSH or use pre-shared token
      # Note: In production, use a secrets manager
      - |
        until curl -sf http://${hcloud_server_network.master[0].ip}:6443/healthz; do
          echo "Waiting for master..."
          sleep 10
        done
      
      # Install K3s agent with Docker runtime
      - |
        curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${var.k3s_version}" \
          K3S_URL="https://${hcloud_server_network.master[0].ip}:6443" \
          K3S_TOKEN="$${K3S_TOKEN}" \
          sh -s - agent \
          --docker \
          --node-ip $(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+') \
          --flannel-iface eth0
  EOF
}

# -----------------------------------------------------------------------------
# EU Worker Nodes
# -----------------------------------------------------------------------------
resource "hcloud_server" "worker_eu" {
  count       = var.worker_count_eu
  name        = "${var.cluster_name}-worker-eu-${count.index + 1}"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location_eu
  ssh_keys    = [hcloud_ssh_key.default.id]
  
  firewall_ids = [hcloud_firewall.k3s_worker.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = {
    cluster  = var.cluster_name
    role     = "worker"
    region   = "eu-central"
    workload = "worker"
  }

  depends_on = [hcloud_server.master]
}

resource "hcloud_server_network" "worker_eu" {
  count      = var.worker_count_eu
  server_id  = hcloud_server.worker_eu[count.index].id
  network_id = hcloud_network.k3s.id
  ip         = cidrhost(var.subnet_eu_cidr, 100 + count.index)  # 10.0.1.100, 10.0.1.101
}

# -----------------------------------------------------------------------------
# US Worker Nodes
# -----------------------------------------------------------------------------
resource "hcloud_server" "worker_us" {
  count       = var.worker_count_us
  name        = "${var.cluster_name}-worker-us-${count.index + 1}"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location_us
  ssh_keys    = [hcloud_ssh_key.default.id]
  
  firewall_ids = [hcloud_firewall.k3s_worker.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = {
    cluster  = var.cluster_name
    role     = "worker"
    region   = "us-east"
    workload = "worker"
  }

  depends_on = [hcloud_server.master]
}

resource "hcloud_server_network" "worker_us" {
  count      = var.worker_count_us
  server_id  = hcloud_server.worker_us[count.index].id
  network_id = hcloud_network.k3s.id
  ip         = cidrhost(var.subnet_us_cidr, 100 + count.index)  # 10.0.2.100
}

# -----------------------------------------------------------------------------
# APAC Worker Nodes
# -----------------------------------------------------------------------------
resource "hcloud_server" "worker_apac" {
  count       = var.worker_count_apac
  name        = "${var.cluster_name}-worker-apac-${count.index + 1}"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location_apac
  ssh_keys    = [hcloud_ssh_key.default.id]
  
  firewall_ids = [hcloud_firewall.k3s_worker.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = {
    cluster  = var.cluster_name
    role     = "worker"
    region   = "asia-pacific"
    workload = "worker"
  }

  depends_on = [hcloud_server.master]
}

resource "hcloud_server_network" "worker_apac" {
  count      = var.worker_count_apac
  server_id  = hcloud_server.worker_apac[count.index].id
  network_id = hcloud_network.k3s.id
  ip         = cidrhost(var.subnet_apac_cidr, 100 + count.index)  # 10.0.3.100
}
