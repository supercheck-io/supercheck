# Hetzner Cloud Terraform Configuration
# Provisions K3s cluster with vSwitch networking across multiple regions

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

# Configure the Hetzner Cloud Provider
provider "hcloud" {
  token = var.hcloud_token
}

# -----------------------------------------------------------------------------
# vSwitch Network (spans all Hetzner locations)
# -----------------------------------------------------------------------------
resource "hcloud_network" "k3s" {
  name     = "${var.cluster_name}-network"
  ip_range = var.network_cidr
}

# Subnet for EU region
resource "hcloud_network_subnet" "eu" {
  network_id   = hcloud_network.k3s.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = var.subnet_eu_cidr
}

# Subnet for US region
resource "hcloud_network_subnet" "us" {
  network_id   = hcloud_network.k3s.id
  type         = "cloud"
  network_zone = "us-east"
  ip_range     = var.subnet_us_cidr
}

# Subnet for APAC region
resource "hcloud_network_subnet" "apac" {
  network_id   = hcloud_network.k3s.id
  type         = "cloud"
  network_zone = "ap-southeast"
  ip_range     = var.subnet_apac_cidr
}

# -----------------------------------------------------------------------------
# Firewall Rules
# -----------------------------------------------------------------------------
resource "hcloud_firewall" "k3s_master" {
  name = "${var.cluster_name}-master-fw"

  # SSH
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = var.ssh_allowed_ips
  }

  # K3s API
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "6443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP/HTTPS (Ingress)
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # ICMP
  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall" "k3s_worker" {
  name = "${var.cluster_name}-worker-fw"

  # SSH
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = var.ssh_allowed_ips
  }

  # ICMP
  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # NodePort range (optional - for debugging)
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "30000-32767"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

# -----------------------------------------------------------------------------
# SSH Key
# -----------------------------------------------------------------------------
resource "hcloud_ssh_key" "default" {
  name       = "${var.cluster_name}-ssh-key"
  public_key = var.ssh_public_key
}
