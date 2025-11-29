output "kubeconfig" {
  description = "Kubeconfig content"
  value       = module.k3s_cluster.kubeconfig
  sensitive   = true
}

output "kubeconfig_path" {
  description = "Path to kubeconfig file on master"
  value       = module.k3s_cluster.kubeconfig_path
}

output "api_endpoint" {
  description = "Kubernetes API endpoint (Load Balancer IP)"
  value       = module.k3s_cluster.api_endpoint
}

output "nodes" {
  description = "Cluster nodes"
  value       = module.k3s_cluster.nodes
}

output "load_balancer_ip" {
  description = "Load Balancer Public IP"
  value       = module.k3s_cluster.load_balancer_ip
}

output "next_steps" {
  description = "Recommended next steps"
  value = <<-EOT
    1. Retrieve kubeconfig:
       scp -i ~/.ssh/id_rsa root@${module.k3s_cluster.nodes[0].public_ipv4}:~/.kube/config ~/.kube/config-supercheck
       export KUBECONFIG=~/.kube/config-supercheck

    2. Verify cluster:
       kubectl get nodes

    3. Install KEDA:
       helm repo add kedacore https://kedacore.github.io/charts
       helm install keda kedacore/keda --namespace keda --create-namespace

    4. Deploy applications:
       cd ../helm
       helm install supercheck ./chart -f values-production.yaml
  EOT
}
