terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Create VPC network
resource "hcloud_network" "k3s" {
  name       = "${var.cluster_name}-network"
  ip_range   = var.network_ip_range
  labels     = var.common_tags
}

# Create subnet
resource "hcloud_network_subnet" "k3s" {
  network_id        = hcloud_network.k3s.id
  type              = "cloud"
  network_zone      = "eu-central" # Should match location's zone
  ip_range          = var.network_ip_range
}

# Create firewall
resource "hcloud_firewall" "k3s" {
  name   = "${var.cluster_name}-firewall"
  labels = var.common_tags

  # Inbound: Allow SSH
  rule {
    direction  = "in"
    source_ips = ["0.0.0.0/0", "::/0"]
    protocol   = "tcp"
    port       = "22"
  }

  # Inbound: Allow Kubernetes API (via LB or direct)
  rule {
    direction  = "in"
    source_ips = ["0.0.0.0/0", "::/0"]
    protocol   = "tcp"
    port       = "6443"
  }

  # Inbound: Allow HTTP/HTTPS
  rule {
    direction  = "in"
    source_ips = ["0.0.0.0/0", "::/0"]
    protocol   = "tcp"
    port       = "80"
  }

  rule {
    direction  = "in"
    source_ips = ["0.0.0.0/0", "::/0"]
    protocol   = "tcp"
    port       = "443"
  }

  # Outbound: Allow all TCP
  rule {
    direction       = "out"
    destination_ips = ["0.0.0.0/0", "::/0"]
    protocol        = "tcp"
    port            = "1-65535"
  }

  # Outbound: Allow all UDP
  rule {
    direction       = "out"
    destination_ips = ["0.0.0.0/0", "::/0"]
    protocol        = "udp"
    port            = "1-65535"
  }
}

# Create SSH key
resource "hcloud_ssh_key" "k3s" {
  name       = "${var.cluster_name}-key"
  public_key = var.ssh_public_key
  labels     = var.common_tags
}

# Generate K3s token
resource "random_password" "k3s_token" {
  length  = 32
  special = false
}

# Create Load Balancer for API Server
resource "hcloud_load_balancer" "k3s_api" {
  name               = "${var.cluster_name}-api-lb"
  load_balancer_type = "lb11"
  location           = var.location
  labels             = var.common_tags
}

resource "hcloud_load_balancer_network" "k3s_api" {
  load_balancer_id = hcloud_load_balancer.k3s_api.id
  network_id       = hcloud_network.k3s.id
}

resource "hcloud_load_balancer_service" "k3s_api" {
  load_balancer_id = hcloud_load_balancer.k3s_api.id
  protocol         = "tcp"
  listen_port      = 6443
  destination_port = 6443
}

resource "hcloud_load_balancer_target" "k3s_api" {
  type             = "label_selector"
  load_balancer_id = hcloud_load_balancer.k3s_api.id
  label_selector   = "role=master,cluster=${var.cluster_name}"
  use_private_ip   = true
  depends_on       = [hcloud_load_balancer_network.k3s_api]
}

# Create K3s master nodes
resource "hcloud_server" "k3s_master" {
  count       = var.master_count
  name        = "${var.cluster_name}-master-${count.index + 1}"
  server_type = var.master_server_type
  image       = "ubuntu-22.04"
  location    = var.location
  
  ssh_keys     = [hcloud_ssh_key.k3s.id]
  firewall_ids = [hcloud_firewall.k3s.id]

  network {
    network_id = hcloud_network.k3s.id
  }

  labels = merge(
    var.common_tags,
    {
      role           = "master"
      cluster        = var.cluster_name
      node_type      = var.master_server_type
      workload       = "app" # Masters can run app workloads if needed, or taint them
    }
  )

  # First master initializes the cluster
  # Subsequent masters join
  user_data = templatefile("${path.module}/cloud-init-master.sh", {
    k3s_version  = var.k3s_version
    cluster_init = count.index == 0 ? "--cluster-init" : "--server https://${hcloud_server.k3s_master[0].primary_ip}:6443" # Use internal IP of first master for joining
    # Better HA join: use LB IP if possible, but internal IP is safer for bootstrap. 
    # For HA with embedded etcd, we need to join an existing server.
    # We'll use the first master's private IP.
    node_token   = random_password.k3s_token.result
    lb_api_ip    = hcloud_load_balancer.k3s_api.ipv4 # Advertise LB IP
  })

  depends_on = [hcloud_network_subnet.k3s, hcloud_load_balancer_network.k3s_api]
}

# Create K3s worker nodes
resource "hcloud_server" "k3s_worker" {
  count        = var.worker_count
  name         = "${var.cluster_name}-worker-${count.index + 1}"
  server_type  = var.worker_server_type
  image        = "ubuntu-22.04"
  location     = var.location
  
  ssh_keys     = [hcloud_ssh_key.k3s.id]
  firewall_ids = [hcloud_firewall.k3s.id]

  network {
    network_id = hcloud_network.k3s.id
  }

  labels = merge(
    var.common_tags,
    {
      role           = "worker"
      cluster        = var.cluster_name
      node_type      = var.worker_server_type
      workload       = "worker"
    }
  )

  user_data = templatefile("${path.module}/cloud-init-worker.sh", {
    k3s_version      = var.k3s_version
    k3s_server_url   = "https://${hcloud_load_balancer.k3s_api.ipv4}:6443" # Workers join via LB
    k3s_token        = random_password.k3s_token.result
  })

  depends_on = [
    hcloud_network_subnet.k3s,
    hcloud_server.k3s_master,
    hcloud_load_balancer_service.k3s_api
  ]
}

# Create placement groups
resource "hcloud_placement_group" "k3s_master" {
  name   = "${var.cluster_name}-master-pg"
  type   = "spread"
  labels = var.common_tags
}

resource "hcloud_placement_group" "k3s_worker" {
  name   = "${var.cluster_name}-worker-pg"
  type   = "spread"
  labels = var.common_tags
}
