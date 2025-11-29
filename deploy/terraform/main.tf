# Hetzner Cloud Provider
provider "hcloud" {
  token = var.hcloud_token
}

locals {
  app_name = "supercheck"
  
  common_tags = merge(
    {
      Project     = local.app_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      CreatedAt   = timestamp()
    },
    var.tags
  )
}

# Create single HA K3s Cluster
module "k3s_cluster" {
  source = "./modules/k3s-cluster"

  cluster_name    = "${local.app_name}-${var.environment}"
  location        = var.location
  hcloud_token    = var.hcloud_token
  
  # Node configuration
  master_count       = var.master_count
  worker_count       = var.worker_count
  master_server_type = var.master_server_type
  worker_server_type = var.worker_server_type
  
  # K3s configuration
  k3s_version     = var.k3s_version
  cluster_cidr    = "10.0.0.0/16"
  network_ip_range = "10.0.0.0/16"
  
  # Tags and labels
  common_tags     = local.common_tags
  
  # SSH key
  ssh_public_key  = var.ssh_public_key
}

# Deploy monitoring (optional)
module "monitoring" {
  count = var.enable_monitoring ? 1 : 0

  source = "./modules/monitoring"

  region_name     = var.location
  kubeconfig_path = module.k3s_cluster.kubeconfig_path
  
  depends_on = [module.k3s_cluster]
}
