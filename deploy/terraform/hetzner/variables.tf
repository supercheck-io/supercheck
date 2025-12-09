# Terraform Variables for Hetzner K3s Cluster

# -----------------------------------------------------------------------------
# Required Variables
# -----------------------------------------------------------------------------

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key for server access"
  type        = string
}

# -----------------------------------------------------------------------------
# Cluster Configuration
# -----------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "supercheck"
}

variable "k3s_version" {
  description = "K3s version to install"
  type        = string
  default     = "v1.28.4+k3s2"
}

# -----------------------------------------------------------------------------
# Network Configuration
# -----------------------------------------------------------------------------

variable "network_cidr" {
  description = "CIDR for the vSwitch network"
  type        = string
  default     = "10.0.0.0/8"
}

variable "subnet_eu_cidr" {
  description = "CIDR for EU subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "subnet_us_cidr" {
  description = "CIDR for US subnet"
  type        = string
  default     = "10.0.2.0/24"
}

variable "subnet_apac_cidr" {
  description = "CIDR for APAC subnet"
  type        = string
  default     = "10.0.3.0/24"
}

# -----------------------------------------------------------------------------
# Server Configuration
# -----------------------------------------------------------------------------

variable "server_type" {
  description = "Hetzner server type for all nodes"
  type        = string
  default     = "cx22"  # 2 vCPU, 4 GB RAM
}

variable "server_image" {
  description = "OS image for servers"
  type        = string
  default     = "ubuntu-24.04"
}

# -----------------------------------------------------------------------------
# Node Counts
# -----------------------------------------------------------------------------

variable "master_count" {
  description = "Number of master nodes (1 or 3 for HA)"
  type        = number
  default     = 1
}

variable "worker_count_eu" {
  description = "Number of worker nodes in EU"
  type        = number
  default     = 1
}

variable "worker_count_us" {
  description = "Number of worker nodes in US"
  type        = number
  default     = 1
}

variable "worker_count_apac" {
  description = "Number of worker nodes in APAC"
  type        = number
  default     = 1
}

variable "app_node_count" {
  description = "Number of app nodes"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# Location Mapping
# -----------------------------------------------------------------------------

variable "location_eu" {
  description = "Hetzner location for EU"
  type        = string
  default     = "fsn1"  # Falkenstein
}

variable "location_us" {
  description = "Hetzner location for US"
  type        = string
  default     = "ash"   # Ashburn
}

variable "location_apac" {
  description = "Hetzner location for APAC"
  type        = string
  default     = "sin"   # Singapore
}

# -----------------------------------------------------------------------------
# Security
# -----------------------------------------------------------------------------

variable "ssh_allowed_ips" {
  description = "IPs allowed to SSH (your IP)"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]  # Restrict in production!
}
