# Kubernetes Node Setup & Configuration

This guide covers setting up and configuring your K3s cluster nodes for optimal Supercheck deployment with node affinity and workload isolation.

## Prerequisites

- K3s cluster running on Hetzner Cloud (or similar infrastructure)
- `kubectl` configured to access your cluster
- Cluster admin permissions

## Node Architecture

The Supercheck deployment uses three types of nodes:

| Node Type | Size | Role | Workload |
|-----------|------|------|----------|
| **App** | cx31 (2vCPU, 4GB) | Application servers | Next.js app, API, validation |
| **Worker** | cx41 (4vCPU, 16GB) | Test execution | Playwright, K6, Docker |
| **Database** | cx31 (2vCPU, 4GB) | Data persistence | PostgreSQL, Redis, MinIO |

## Step 1: Label Your Nodes

First, get a list of all nodes:

```bash
kubectl get nodes
```

Output example:
```
NAME                 STATUS   ROLES    AGE   VERSION
k3s-app-1            Ready    master   10d   v1.28.0
k3s-app-2            Ready    <none>   10d   v1.28.0
k3s-worker-1         Ready    <none>   9d    v1.28.0
k3s-worker-2         Ready    <none>   9d    v1.28.0
k3s-db-1             Ready    <none>   8d    v1.28.0
```

### Label App Nodes

```bash
# App nodes - for Next.js frontend
kubectl label nodes k3s-app-1 workload=app
kubectl label nodes k3s-app-2 workload=app
```

### Label Worker Nodes

```bash
# Worker nodes - for test execution with Docker
kubectl label nodes k3s-worker-1 workload=worker
kubectl label nodes k3s-worker-2 workload=worker
```

### Label Database Nodes (Optional)

```bash
# Database nodes - for stateful services
kubectl label nodes k3s-db-1 workload=database
```

Verify labels:

```bash
kubectl get nodes --show-labels
```

## Step 2: Apply Node Taints

Taints prevent pods without matching tolerations from being scheduled on specific nodes.

### Taint App Nodes

```bash
# Only app pods can run on app nodes
kubectl taint nodes k3s-app-1 workload=app:NoSchedule
kubectl taint nodes k3s-app-2 workload=app:NoSchedule
```

### Taint Worker Nodes

```bash
# Only worker pods can run on worker nodes
kubectl taint nodes k3s-worker-1 workload=worker:NoSchedule
kubectl taint nodes k3s-worker-2 workload=worker:NoSchedule
```

### Taint Database Nodes (Optional)

```bash
# Only database pods can run on database nodes
kubectl taint nodes k3s-db-1 workload=database:NoSchedule
```

Verify taints:

```bash
kubectl describe nodes k3s-app-1 | grep Taints
kubectl describe nodes k3s-worker-1 | grep Taints
```

## Step 3: Verify Node Configuration

Check that all labels and taints are correctly applied:

```bash
# Show all labels and taints
for node in $(kubectl get nodes -o name); do
  echo "=== $node ==="
  kubectl describe $node | grep -A 5 "Labels:"
  kubectl describe $node | grep -A 5 "Taints:"
done
```

## Step 4: Enable Docker on Worker Nodes (If Required)

If your worker nodes are running K3s with containerd, you may need to install Docker for the cluster-autoscaler and worker pods.

### Install Docker on Worker Nodes

```bash
# SSH into each worker node
ssh user@worker-node-ip

# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group (optional, if not running as root)
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker is running
docker ps
```

### Configure Docker Socket Permissions

The worker pods need read-only access to the Docker socket:

```bash
# Check Docker socket permissions (usually already correct)
ls -la /var/run/docker.sock

# If needed, adjust permissions (do this on the host, not in a pod)
sudo chmod 666 /var/run/docker.sock
```

## Step 5: Install KEDA (Kubernetes Event Autoscaling)

KEDA is required for scaling worker pods based on queue depth.

```bash
# Install KEDA
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.2/keda-2.13.2.yaml

# Verify KEDA is running
kubectl get pods -n keda
```

## Step 6: Install Cluster Autoscaler

The cluster autoscaler automatically scales nodes up/down based on pod resource requests.

```bash
# Create Hetzner Cloud token secret
kubectl create secret generic hcloud-token \
  -n kube-system \
  --from-literal=token=YOUR_HETZNER_CLOUD_TOKEN

# Deploy cluster autoscaler
kubectl apply -f deploy/k8s/cluster-autoscaler.yaml

# Verify deployment
kubectl get pods -n kube-system | grep cluster-autoscaler
```

## Node Anti-Affinity Best Practices

The deployment manifests use pod anti-affinity to spread replicas across nodes:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: supercheck
              component: app
          topologyKey: kubernetes.io/hostname
```

This ensures:
- **HA**: App pods run on different nodes
- **Resilience**: Worker pods spread across nodes
- **Resource efficiency**: Better resource utilization

## Resource Planning

### App Node Sizing

Each app node should have:
- **CPU**: 2+ vCPU (Next.js app requires ~0.5 vCPU baseline)
- **Memory**: 4GB+ (2GB baseline + buffer)
- **Disk**: 50GB+ (for logs, cache, temp files)

### Worker Node Sizing

Each worker node should have:
- **CPU**: 4+ vCPU (Docker containers consume 1-2 vCPU each)
- **Memory**: 16GB+ (for running multiple containers)
- **Disk**: 100GB+ (for reports, artifacts, test data)
- **Docker**: Available on the host

### Database Node Sizing

For managed databases (recommended):
- Use Hetzner Cloud or AWS managed services
- See specs/08-operations/ for configuration

For self-hosted:
- PostgreSQL: 2+ vCPU, 4GB+ memory
- Redis: 1+ vCPU, 4GB+ memory
- MinIO: 2+ vCPU, 8GB+ memory

## Scaling the Cluster

### Add More Worker Nodes

```bash
# Provision new worker node on Hetzner Cloud
# Label it
kubectl label nodes k3s-worker-3 workload=worker

# Taint it
kubectl taint nodes k3s-worker-3 workload=worker:NoSchedule

# KEDA will automatically scale workers to use the new node
```

### Remove a Worker Node

```bash
# Drain the node (gracefully evict pods)
kubectl drain k3s-worker-1 --ignore-daemonsets --delete-emptydir-data

# Remove the node
kubectl delete node k3s-worker-1

# Deprovision the node on Hetzner Cloud
```

## Troubleshooting

### Pods Stuck in Pending

```bash
# Check node affinity/taints
kubectl describe pod <pod-name> -n supercheck

# Common issue: Pod doesn't have matching toleration for taint
# Solution: Verify the deployment manifest has correct tolerations
```

### Worker Can't Access Docker Socket

```bash
# Verify volume mount is correct
kubectl exec -it <worker-pod> -- ls -la /var/run/docker.sock

# Check Docker socket on host
ssh worker-node
ls -la /var/run/docker.sock

# If it doesn't exist, install Docker on the node
```

### Cluster Autoscaler Not Scaling

```bash
# Check autoscaler logs
kubectl logs -f deployment/cluster-autoscaler -n kube-system

# Verify Hetzner Cloud token
kubectl get secret hcloud-token -n kube-system -o jsonpath='{.data.token}' | base64 -d

# Check autoscaler RBAC permissions
kubectl get clusterrolebinding cluster-autoscaler
```

### KEDA Not Scaling Workers

```bash
# Check KEDA logs
kubectl logs -f deployment/keda-operator -n keda

# Verify ScaledObject status
kubectl describe scaledobject scaler-worker-us -n supercheck

# Check Redis connectivity from pod
kubectl exec -it <worker-pod> -- redis-cli -a PASSWORD ping
```

## Monitoring

### View Node Status

```bash
# Show node metrics (requires metrics-server)
kubectl top nodes

# Show detailed node info
kubectl describe node k3s-worker-1
```

### View Pod Placement

```bash
# Show which node each pod is running on
kubectl get pods -n supercheck -o wide

# Show pod resource usage
kubectl top pods -n supercheck
```

### Watch KEDA Scaling

```bash
# Watch HPA created by KEDA
kubectl get hpa -n supercheck -w

# Check HPA details
kubectl describe hpa keda-scaler-worker-us -n supercheck
```

## References

- [Kubernetes Node Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity)
- [Kubernetes Taints & Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [KEDA ScaledObject](https://keda.sh/docs/2.0/concepts/scaling-deployments/)
- [Cluster Autoscaler on Hetzner](https://github.com/hetznercloud/autoscaler)
