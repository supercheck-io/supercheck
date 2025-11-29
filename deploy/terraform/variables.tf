variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name (development, staging, production)"
  type        = string
  default     = "production"
}

variable "location" {
  description = "Hetzner Cloud location (e.g., fsn1, nbg1, hel1, ash, hil)"
  type        = string
  default     = "fsn1"
}

variable "master_server_type" {
  description = "Hetzner Cloud server type for K3s master nodes (e.g., cx21)"
  type        = string
}

variable "worker_server_type" {
  description = "Hetzner Cloud server type for K3s worker nodes (e.g., cpx31)"
  type        = string
}

variable "master_count" {
  description = "Number of K3s master nodes (odd number for HA)"
  type        = number
  default     = 3
}

variable "worker_count" {
  description = "Number of K3s worker nodes"
  type        = number
  default     = 3
}

variable "k3s_version" {
  description = "K3s version to install"
  type        = string
  default     = "v1.28.0+k3s1"
}

variable "ssh_public_key" {
  description = "SSH public key for accessing nodes"
  type        = string
}

variable "enable_monitoring" {
  description = "Enable Prometheus/Grafana monitoring"
  type        = bool
  default     = true
}

variable "enable_cluster_autoscaler" {
  description = "Enable Cluster Autoscaler for node scaling"
  type        = bool
  default     = true
}

variable "max_worker_nodes" {
  description = "Maximum number of worker nodes (for Cluster Autoscaler)"
  type        = number
  default     = 20
}

variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
