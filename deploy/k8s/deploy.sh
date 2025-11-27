#!/bin/bash
set -e

# Supercheck K3s Deployment Script
# This script automates the deployment of Supercheck to a K3s cluster
# with proper node labeling, tainting, and affinity configuration

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="supercheck"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/../.." && pwd )"

# Default values (override with env vars)
HCLOUD_TOKEN="${HCLOUD_TOKEN:-}"
REDIS_URL="${REDIS_URL:-}"
DATABASE_URL="${DATABASE_URL:-}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

# Functions
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

check_requirements() {
    print_header "Checking Requirements"

    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed"
        exit 1
    fi
    print_success "kubectl is installed"

    if ! command -v kustomize &> /dev/null; then
        print_warning "kustomize is not installed (optional, using kubectl apply directly)"
    else
        print_success "kustomize is installed"
    fi
}

check_cluster_access() {
    print_header "Checking Cluster Access"

    if ! kubectl cluster-info &> /dev/null; then
        print_error "Cannot access Kubernetes cluster"
        exit 1
    fi

    CLUSTER_NAME=$(kubectl config current-context)
    print_success "Connected to cluster: $CLUSTER_NAME"

    # Check node count
    NODE_COUNT=$(kubectl get nodes --no-headers | wc -l)
    print_success "Cluster has $NODE_COUNT nodes"
}

check_environment_variables() {
    print_header "Checking Environment Variables"

    local missing_vars=()

    if [ -z "$HCLOUD_TOKEN" ]; then
        missing_vars+=("HCLOUD_TOKEN")
    fi

    if [ -z "$DATABASE_URL" ]; then
        missing_vars+=("DATABASE_URL")
    fi

    if [ -z "$REDIS_URL" ]; then
        missing_vars+=("REDIS_URL")
    fi

    if [ -z "$BETTER_AUTH_SECRET" ]; then
        missing_vars+=("BETTER_AUTH_SECRET")
    fi

    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        exit 1
    fi

    print_success "All required environment variables are set"
}

create_namespace() {
    print_header "Creating Namespace"

    if kubectl get namespace $NAMESPACE &> /dev/null; then
        print_warning "Namespace $NAMESPACE already exists"
        return
    fi

    kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
    print_success "Namespace created: $NAMESPACE"
}

create_secrets() {
    print_header "Creating Secrets"

    # Create or update supercheck-secret
    kubectl create secret generic supercheck-secret \
        --from-literal=DATABASE_URL="$DATABASE_URL" \
        --from-literal=REDIS_URL="$REDIS_URL" \
        --from-literal=REDIS_PASSWORD="${REDIS_URL##*:}" \
        --from-literal=BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
        --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
        -n $NAMESPACE \
        --dry-run=client -o yaml | kubectl apply -f -

    print_success "Created secret: supercheck-secret"

    # Create or update hcloud-token secret
    if [ -n "$HCLOUD_TOKEN" ]; then
        kubectl create secret generic hcloud-token \
            --from-literal=token="$HCLOUD_TOKEN" \
            -n kube-system \
            --dry-run=client -o yaml | kubectl apply -f -
        print_success "Created secret: hcloud-token"
    else
        print_warning "HCLOUD_TOKEN not provided, skipping hcloud-token secret"
    fi
}

apply_configmaps() {
    print_header "Applying ConfigMaps"

    kubectl apply -f "$SCRIPT_DIR/configmap.yaml"
    print_success "Applied ConfigMap: supercheck-config"
}

check_node_labels() {
    print_header "Checking Node Labels and Taints"

    local app_nodes=$(kubectl get nodes -l workload=app --no-headers | wc -l)
    local worker_nodes=$(kubectl get nodes -l workload=worker --no-headers | wc -l)

    if [ "$app_nodes" -eq 0 ]; then
        print_warning "No nodes labeled with workload=app"
        print_warning "Run: kubectl label nodes <node> workload=app"
    else
        print_success "Found $app_nodes app nodes"
    fi

    if [ "$worker_nodes" -eq 0 ]; then
        print_warning "No nodes labeled with workload=worker"
        print_warning "Run: kubectl label nodes <node> workload=worker"
    else
        print_success "Found $worker_nodes worker nodes"
    fi

    # Check taints
    local tainted_workers=$(kubectl get nodes -l workload=worker --no-headers | grep -c "workload=worker:NoSchedule" || true)
    if [ "$tainted_workers" -eq 0 ]; then
        print_warning "Worker nodes not tainted"
        print_warning "Run: kubectl taint nodes <worker-node> workload=worker:NoSchedule"
    fi
}

install_keda() {
    print_header "Installing KEDA"

    if kubectl get namespace keda &> /dev/null; then
        print_warning "KEDA already installed"
        return
    fi

    print_warning "Installing KEDA from GitHub releases..."
    kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.2/keda-2.13.2.yaml

    # Wait for KEDA to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/keda-operator -n keda 2>/dev/null || true

    print_success "KEDA installed"
}

deploy_cluster_autoscaler() {
    print_header "Deploying Cluster Autoscaler"

    if [ -z "$HCLOUD_TOKEN" ]; then
        print_warning "HCLOUD_TOKEN not provided, skipping Cluster Autoscaler"
        return
    fi

    kubectl apply -f "$SCRIPT_DIR/cluster-autoscaler.yaml"
    print_success "Cluster Autoscaler deployed"
}

deploy_manifests() {
    print_header "Deploying Supercheck Manifests"

    # Apply ConfigMap and Secret first
    kubectl apply -f "$SCRIPT_DIR/configmap.yaml"
    kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
    kubectl apply -f "$SCRIPT_DIR/serviceaccount.yaml"

    # Apply deployments
    kubectl apply -f "$SCRIPT_DIR/app-deployment.yaml"
    kubectl apply -f "$SCRIPT_DIR/worker-deployment.yaml"
    kubectl apply -f "$SCRIPT_DIR/keda-scaledobject.yaml"

    # Apply services and PDBs
    kubectl apply -f "$SCRIPT_DIR/app-service.yaml"
    kubectl apply -f "$SCRIPT_DIR/worker-service.yaml"
    kubectl apply -f "$SCRIPT_DIR/pdb-app.yaml"
    kubectl apply -f "$SCRIPT_DIR/pdb-worker.yaml"

    print_success "All manifests deployed"
}

wait_for_rollout() {
    print_header "Waiting for Rollout"

    # Wait for app deployment
    echo "Waiting for app deployment..."
    kubectl rollout status deployment/supercheck-app -n $NAMESPACE --timeout=5m || {
        print_error "App deployment failed to roll out"
        return 1
    }
    print_success "App deployment rolled out"

    # Wait for worker deployment (only if nodes are labeled)
    local worker_nodes=$(kubectl get nodes -l workload=worker --no-headers | wc -l)
    if [ "$worker_nodes" -gt 0 ]; then
        echo "Waiting for worker deployments..."
        kubectl rollout status deployment/supercheck-worker-us -n $NAMESPACE --timeout=5m || {
            print_warning "Worker deployment did not roll out (may be pending nodes)"
        }
        print_success "Worker deployment attempted"
    else
        print_warning "No worker nodes found, skipping worker deployment wait"
    fi
}

print_summary() {
    print_header "Deployment Summary"

    echo "Namespace: $NAMESPACE"
    echo ""

    echo "Application Pods:"
    kubectl get pods -n $NAMESPACE -o wide | grep -E "NAME|supercheck-app" || true
    echo ""

    echo "Worker Pods:"
    kubectl get pods -n $NAMESPACE -o wide | grep -E "NAME|supercheck-worker" || true
    echo ""

    echo "Services:"
    kubectl get svc -n $NAMESPACE
    echo ""

    echo "Scaling Objects (KEDA):"
    kubectl get scaledobject -n $NAMESPACE || true
    echo ""

    print_success "Deployment complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Monitor deployments: kubectl get pods -n $NAMESPACE -w"
    echo "  2. Check logs: kubectl logs -f deployment/supercheck-app -n $NAMESPACE"
    echo "  3. Scale workers: kubectl scale deployment supercheck-worker-us -n $NAMESPACE --replicas=3"
    echo ""
}

# Main execution
main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║     Supercheck K3s Deployment Script                  ║"
    echo "║     Deploying to: $(kubectl config current-context | cut -c1-48)  ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    check_requirements
    check_cluster_access
    check_environment_variables
    create_namespace
    create_secrets
    apply_configmaps
    check_node_labels
    install_keda
    deploy_cluster_autoscaler
    deploy_manifests
    wait_for_rollout
    print_summary
}

# Run main function
main
