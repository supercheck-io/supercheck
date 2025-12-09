# Terraform Outputs

# -----------------------------------------------------------------------------
# Master Node
# -----------------------------------------------------------------------------
output "master_public_ip" {
  description = "Public IP of the master node"
  value       = hcloud_server.master[0].ipv4_address
}

output "master_private_ip" {
  description = "Private IP of the master node (vSwitch)"
  value       = hcloud_server_network.master[0].ip
}

# -----------------------------------------------------------------------------
# App Node
# -----------------------------------------------------------------------------
output "app_public_ips" {
  description = "Public IPs of app nodes"
  value       = [for s in hcloud_server.app : s.ipv4_address]
}

output "app_private_ips" {
  description = "Private IPs of app nodes (vSwitch)"
  value       = [for s in hcloud_server_network.app : s.ip]
}

# -----------------------------------------------------------------------------
# Worker Nodes
# -----------------------------------------------------------------------------
output "worker_eu_public_ips" {
  description = "Public IPs of EU workers"
  value       = [for s in hcloud_server.worker_eu : s.ipv4_address]
}

output "worker_us_public_ips" {
  description = "Public IPs of US workers"
  value       = [for s in hcloud_server.worker_us : s.ipv4_address]
}

output "worker_apac_public_ips" {
  description = "Public IPs of APAC workers"
  value       = [for s in hcloud_server.worker_apac : s.ipv4_address]
}

# -----------------------------------------------------------------------------
# Network
# -----------------------------------------------------------------------------
output "network_id" {
  description = "ID of the vSwitch network"
  value       = hcloud_network.k3s.id
}

output "subnet_eu_cidr" {
  description = "EU subnet CIDR"
  value       = var.subnet_eu_cidr
}

output "subnet_us_cidr" {
  description = "US subnet CIDR"
  value       = var.subnet_us_cidr
}

output "subnet_apac_cidr" {
  description = "APAC subnet CIDR"
  value       = var.subnet_apac_cidr
}

# -----------------------------------------------------------------------------
# SSH Commands
# -----------------------------------------------------------------------------
output "ssh_master" {
  description = "SSH command to master"
  value       = "ssh root@${hcloud_server.master[0].ipv4_address}"
}

output "ssh_worker_commands" {
  description = "SSH commands to all workers"
  value = concat(
    [for s in hcloud_server.worker_eu : "ssh root@${s.ipv4_address} # EU"],
    [for s in hcloud_server.worker_us : "ssh root@${s.ipv4_address} # US"],
    [for s in hcloud_server.worker_apac : "ssh root@${s.ipv4_address} # APAC"]
  )
}

# -----------------------------------------------------------------------------
# Kubeconfig
# -----------------------------------------------------------------------------
output "kubeconfig_command" {
  description = "Command to get kubeconfig from master"
  value       = "ssh root@${hcloud_server.master[0].ipv4_address} 'cat /etc/rancher/k3s/k3s.yaml' | sed 's/127.0.0.1/${hcloud_server.master[0].ipv4_address}/g' > ~/.kube/supercheck-config"
}

# -----------------------------------------------------------------------------
# Node Labeling Commands
# -----------------------------------------------------------------------------
output "node_label_commands" {
  description = "Commands to label nodes after cluster is ready"
  value = <<-EOF
    # Run these commands after the cluster is ready:
    
    # Label app nodes
    %{for i, s in hcloud_server.app~}
    kubectl label nodes ${s.name} workload=app
    %{endfor~}
    
    # Label EU workers
    %{for i, s in hcloud_server.worker_eu~}
    kubectl label nodes ${s.name} workload=worker region=eu-central
    kubectl taint nodes ${s.name} workload=worker:NoSchedule
    %{endfor~}
    
    # Label US workers
    %{for i, s in hcloud_server.worker_us~}
    kubectl label nodes ${s.name} workload=worker region=us-east
    kubectl taint nodes ${s.name} workload=worker:NoSchedule
    %{endfor~}
    
    # Label APAC workers
    %{for i, s in hcloud_server.worker_apac~}
    kubectl label nodes ${s.name} workload=worker region=asia-pacific
    kubectl taint nodes ${s.name} workload=worker:NoSchedule
    %{endfor~}
  EOF
}
