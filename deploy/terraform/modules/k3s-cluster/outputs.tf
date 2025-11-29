output "kubeconfig" {
  value = "" # Cannot easily output content from here without remote-exec or provider
}

output "kubeconfig_path" {
  value = "/etc/rancher/k3s/k3s.yaml"
}

output "api_endpoint" {
  value = "https://${hcloud_load_balancer.k3s_api.ipv4}:6443"
}

output "nodes" {
  value = concat(
    hcloud_server.k3s_master,
    hcloud_server.k3s_worker
  )
}

output "load_balancer_ip" {
  value = hcloud_load_balancer.k3s_api.ipv4
}
