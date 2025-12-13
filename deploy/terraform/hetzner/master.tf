# K3s Master Node(s)

# -----------------------------------------------------------------------------
# Cloud-init for Master Node
# -----------------------------------------------------------------------------
locals {
  master_cloud_init = <<-EOF
    #cloud-config
    package_update: true
    package_upgrade: true
    
    packages:
      - curl
      - wget
      - jq
      - htop
      - fail2ban

    write_files:
      - path: /etc/sysctl.d/99-kubernetes.conf
        content: |
          net.ipv4.ip_forward = 1
          net.bridge.bridge-nf-call-iptables = 1
          net.bridge.bridge-nf-call-ip6tables = 1
          fs.inotify.max_user_watches = 524288
          fs.inotify.max_user_instances = 512
      
      # Traefik configuration for automatic TLS with Let's Encrypt
      - path: /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
        content: |
          apiVersion: helm.cattle.io/v1
          kind: HelmChartConfig
          metadata:
            name: traefik
            namespace: kube-system
          spec:
            valuesContent: |-
              additionalArguments:
                - "--certificatesresolvers.letsencrypt.acme.email=admin@supercheck.io"
                - "--certificatesresolvers.letsencrypt.acme.storage=/data/acme.json"
                - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
              persistence:
                enabled: true
              ports:
                websecure:
                  tls:
                    enabled: true
        
    runcmd:
      # Load bridge module
      - modprobe br_netfilter
      - echo 'br_netfilter' > /etc/modules-load.d/br_netfilter.conf
      - sysctl --system
      
      # Disable swap
      - swapoff -a
      - sed -i '/ swap / s/^/#/' /etc/fstab
      
      # Wait for network
      - sleep 10
      
      # Install K3s server (with Traefik + built-in ACME)
      - |
        curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${var.k3s_version}" sh -s - server \
          --cluster-init \
          --tls-san ${hcloud_server.master[0].ipv4_address} \
          --node-ip $(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+') \
          --flannel-iface eth0 \
          --write-kubeconfig-mode 644
      
      # Wait for K3s to be ready
      - sleep 30
      
      # Install KEDA for worker autoscaling
      - kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml
      
      # Save join token to file
      - cat /var/lib/rancher/k3s/server/node-token > /root/k3s-token
  EOF
}

# -----------------------------------------------------------------------------
# Master Server
# -----------------------------------------------------------------------------
resource "hcloud_server" "master" {
  count       = var.master_count
  name        = "${var.cluster_name}-master-${count.index + 1}"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location_eu
  ssh_keys    = [hcloud_ssh_key.default.id]
  
  firewall_ids = [hcloud_firewall.k3s_master.id]
  
  user_data = local.master_cloud_init

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = {
    cluster = var.cluster_name
    role    = "master"
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Attach master to vSwitch network
resource "hcloud_server_network" "master" {
  count      = var.master_count
  server_id  = hcloud_server.master[count.index].id
  network_id = hcloud_network.k3s.id
  ip         = cidrhost(var.subnet_eu_cidr, 10 + count.index)  # 10.0.1.10, 10.0.1.11, etc.
}

# -----------------------------------------------------------------------------
# App Node
# -----------------------------------------------------------------------------
resource "hcloud_server" "app" {
  count       = var.app_node_count
  name        = "${var.cluster_name}-app-${count.index + 1}"
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
    role     = "app"
    workload = "app"
  }

  depends_on = [hcloud_server.master]
}

# Attach app node to vSwitch network
resource "hcloud_server_network" "app" {
  count      = var.app_node_count
  server_id  = hcloud_server.app[count.index].id
  network_id = hcloud_network.k3s.id
  ip         = cidrhost(var.subnet_eu_cidr, 20 + count.index)  # 10.0.1.20
}
