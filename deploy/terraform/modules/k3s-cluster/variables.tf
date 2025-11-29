variable "cluster_name" {
  type = string
}

variable "location" {
  type = string
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "master_count" {
  type = number
  default = 3
}

variable "worker_count" {
  type = number
  default = 3
}

variable "master_server_type" {
  type = string
}

variable "worker_server_type" {
  type = string
}

variable "k3s_version" {
  type = string
}

variable "cluster_cidr" {
  type = string
}

variable "network_ip_range" {
  type = string
}

variable "common_tags" {
  type = map(string)
}

variable "ssh_public_key" {
  type = string
}
