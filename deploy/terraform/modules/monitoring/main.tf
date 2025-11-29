# Placeholder for monitoring logic
# This module would typically use the helm provider to install Prometheus/Grafana
# using the provided kubeconfig.

terraform {
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }
  }
}
