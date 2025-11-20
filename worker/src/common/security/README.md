# Security Module - Container Execution

This module provides secure execution of user-supplied scripts using Docker container isolation with comprehensive security controls.

## Features

### 🔒 Security Controls

1. **Container Isolation**
   - Scripts run in isolated Docker containers
   - Read-only root filesystem
   - No privilege escalation (`--security-opt=no-new-privileges`)
   - All Linux capabilities dropped (`--cap-drop=ALL`)
   - Non-root user execution (UID 1000)

2. **Resource Limits**
   - CPU limit (default: 50% of one CPU)
   - Memory limit (default: 512MB)
   - Process limit (max 100 processes)
   - Execution timeout enforcement

3. **Input Validation**
   - Path traversal prevention
   - Command injection protection
   - Argument sanitization
   - Dangerous pattern detection

4. **Automatic Cleanup**
   - Containers auto-removed after execution
   - No local file accumulation (container-based cleanup)
   - Graceful timeout handling

### 🛡️ Defense in Depth

The module implements multiple security layers:

1. **Input Validation** (`path-validator.ts`)
   - Validates all file paths
   - Sanitizes command arguments
   - Blocks dangerous patterns

2. **Container Execution** (`container-executor.service.ts`)
   - Docker-based isolation
   - Resource constraints
   - Network isolation options

3. **Mandatory Container Execution**
   - Container execution is required for all tests
   - No fallback to direct execution
   - Clear error messages when Docker is unavailable

## Usage

### Container Execution Options

```typescript
interface ContainerExecutionOptions {
  timeoutMs?: number;        // Execution timeout (default: 300000ms)
  memoryLimitMb?: number;    // Memory limit (default: 512MB)
  cpuLimit?: number;         // CPU fraction (default: 0.5 = 50%)
  env?: Record<string, string>; // Environment variables
  workingDir?: string;       // Working directory (default: /worker)
  image?: string;            // Docker image override
  networkMode?: 'none' | 'bridge' | 'host'; // Network mode (default: none)
  autoRemove?: boolean;      // Auto-remove container (default: true)
}
```

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────┐
│              ExecutionService                        │
│  (Main orchestrator for test execution)             │
└─────────────────┬───────────────────────────────────┘
                  │
                  │ calls executeCommandSafely()
                  ▼
┌─────────────────────────────────────────────────────┐
│          executeCommandSafely()                      │
│  (Container execution wrapper)                      │
│                                                      │
│  Always uses ContainerExecutorService               │
│            (mandatory container execution)          │
└────────────────────────────────────┬────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────┐
│       ContainerExecutorService                       │
│                                                      │
│  1. Validate paths/arguments                        │
│  2. Check Docker availability                       │
│  3. Build secure Docker command                     │
│  4. Execute with resource limits                    │
│  5. Monitor and cleanup                             │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│              Path Validator                          │
│  - Path traversal prevention                        │
│  - Command injection protection                     │
│  - Argument sanitization                            │
└─────────────────────────────────────────────────────┘
```

### Execution Flow

```
User Script Submission
        │
        ▼
┌─────────────────┐
│ Input Validation│
│  (path-validator)│
└────────┬────────┘
         │ ✓ Valid
         ▼
┌─────────────────┐
│ Docker Available?│
└────────┬────────┘
         │
    Yes  │   No (Error)
         │   │
         ▼   ▼
┌──────────────────────┐
│ Container Execution  │
│  - Build secure cmd  │
│  - Apply limits      │
│  - Mount directories │
│  - Execute & monitor │
│  - Cleanup           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Results & Artifacts │
└──────────────────────┘
```

## Security Guarantees

### What's Protected

✅ **Path Traversal** - All paths validated, no `../` or `~` allowed
✅ **Command Injection** - No shell interpolation, argument arrays only
✅ **Resource DoS** - CPU, memory, and process limits enforced
✅ **Privilege Escalation** - Runs as non-root, no new privileges
✅ **File System Access** - Read-only root, limited write access
✅ **Network Access** - Configurable network isolation
✅ **Code Execution** - Sandboxed environment, auto-cleanup

### Attack Surface Reduction

| Attack Vector | Mitigation |
|--------------|------------|
| Malicious script paths | Path validation + sanitization |
| Shell command injection | Argument arrays, no shell |
| Infinite loops | Timeout enforcement |
| Memory bombs | Memory limits (512MB default) |
| Fork bombs | Process limits (100 max) |
| File system attacks | Read-only root, isolated workspace |
| Network attacks | Network isolation options |
| Privilege escalation | Non-root user, no privileges |

## Monitoring & Debugging

### Check Container Status

```bash
# List active supercheck containers
docker ps --filter "name=supercheck-exec-*"

# View container logs
docker logs <container-name>

# Inspect container
docker inspect <container-name>
```

### Enable Debug Logging

Set log level in your environment:

```env
LOG_LEVEL=debug
```

Debug logs include:
- Container execution attempts
- Fallback decisions
- Path validation results
- Resource usage
- Cleanup operations

### Cleanup Orphaned Containers

The service automatically cleans up orphaned containers, but you can also manually clean:

```bash
# Remove all supercheck execution containers
docker rm -f $(docker ps -a --filter "name=supercheck-exec-*" -q)
```

## Performance Considerations

### Container Overhead

- **Cold start**: ~2-3 seconds (first container)
- **Warm start**: ~500ms-1s (image cached)
- **Memory overhead**: ~50-100MB per container
- **CPU overhead**: Minimal (<5%)

### Optimization Tips

1. **Pre-pull images**: Pull Docker images during deployment
2. **Use image caching**: Keep images on worker nodes
3. **Adjust limits**: Tune CPU/memory for your workload
4. **Network mode**: Use `none` for better isolation, `bridge` for network tests

## Troubleshooting

### Container execution is not working

**Check Docker availability:**
```bash
docker --version
docker ps
```

**Check permissions:**
```bash
# User needs to be in docker group
groups | grep docker

# If not, add user to docker group
sudo usermod -aG docker $USER
# Then logout and login again
```

### Container Execution is Mandatory

Container execution is now mandatory for all tests. Execution will fail with a clear error message if:
- Docker is not installed or not running
- Docker permissions are insufficient
- Required Docker image is not available

**Action Required**: Ensure Docker is properly installed and running with correct permissions.

### Performance issues

If containers are slow:

1. **Pre-pull images**: `docker pull <image>`
2. **Check Docker resources**: Ensure Docker has adequate CPU/memory
3. **Reduce limits**: Lower CPU/memory limits if tests are lightweight
4. **Use local registry**: Cache images in a local registry

## Testing

### Test Container Execution

```bash
# Start worker
npm run start:dev

# Submit a test and check logs for:
# "[Container] Executing in container: ..."
```

### Test Docker Unavailable

```bash
# Stop Docker
sudo systemctl stop docker

# Start worker
npm run start:dev

# Submit a test - should fail with clear error message:
# "Docker is not available or the required image could not be pulled..."
```

## Security Best Practices

1. **Always use container execution in production**
2. **Regularly update Docker images** to patch vulnerabilities
3. **Monitor resource usage** to detect anomalies
4. **Review container logs** for suspicious activity
5. **Use network isolation** (`none`) when tests don't need network
6. **Keep Docker daemon secure** (proper permissions, updated)
7. **Implement rate limiting** for test submissions
8. **Monitor orphaned containers** and clean up regularly

## Contributing

When adding new features:

1. Maintain backward compatibility
2. Add tests for new security controls
3. Document configuration options
4. Update this README
5. Follow the principle of least privilege

## References

- [Docker Security](https://docs.docker.com/engine/security/)
- [OWASP Container Security](https://owasp.org/www-project-docker-top-10/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [Playwright in Docker](https://playwright.dev/docs/docker)
