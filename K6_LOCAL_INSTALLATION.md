# k6 Local Installation Guide

This guide covers installing k6 on your local development machine for testing the k6 performance testing feature.

## Installation by Operating System

### macOS

#### Option 1: Homebrew (Recommended)
```bash
brew install k6
```

#### Option 2: Direct Download
```bash
# Download latest release
curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-darwin-arm64.tar.gz -o k6.tar.gz

# Extract
tar -xzf k6.tar.gz

# Move to /usr/local/bin
sudo mv k6-v0.49.0-darwin-arm64/k6 /usr/local/bin/

# Make executable
sudo chmod +x /usr/local/bin/k6

# Clean up
rm -rf k6.tar.gz k6-v0.49.0-darwin-arm64
```

For Intel Macs, use:
```bash
curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-darwin-amd64.tar.gz -o k6.tar.gz
```

### Linux

#### Option 1: APT (Debian/Ubuntu)
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

#### Option 2: Direct Download
```bash
# Download latest release
curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz -o k6.tar.gz

# Extract
tar -xzf k6.tar.gz

# Move to /usr/local/bin
sudo mv k6-v0.49.0-linux-amd64/k6 /usr/local/bin/

# Make executable
sudo chmod +x /usr/local/bin/k6

# Clean up
rm -rf k6.tar.gz k6-v0.49.0-linux-amd64
```

For ARM64 Linux, use:
```bash
curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-arm64.tar.gz -o k6.tar.gz
```

### Windows

#### Option 1: Chocolatey
```powershell
choco install k6
```

#### Option 2: Winget
```powershell
winget install k6 --source winget
```

#### Option 3: Direct Download
1. Download the latest Windows release from: https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-windows-amd64.zip
2. Extract the ZIP file
3. Add the extracted directory to your PATH environment variable
4. Or move `k6.exe` to a directory already in PATH (e.g., `C:\Windows\System32`)

## Verify Installation

After installation, verify k6 is working:

```bash
k6 version
```

You should see output like:
```
k6 v0.49.0 (commit/..., go1.21.6, darwin/arm64)
```

## Configuration for Supercheck Worker

### Local Development

For local development, the worker will automatically detect k6 if it's in your PATH. No additional configuration needed!

The worker uses this logic:
1. If `K6_BIN_PATH` env var is set → use that path
2. If `NODE_ENV=production` → use `/usr/local/bin/k6` (Docker)
3. Otherwise → use `k6` (assumes it's in PATH for local dev)

### Optional: Explicit Path Configuration

If k6 is installed in a non-standard location, set the path in `worker/.env`:

```bash
# Linux/macOS
K6_BIN_PATH=/usr/local/bin/k6

# Windows
K6_BIN_PATH=C:\Program Files\k6\k6.exe

# Custom location
K6_BIN_PATH=/path/to/your/k6
```

## Testing k6 Locally

Create a simple test file `test.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '10s',
};

export default function() {
  const response = http.get('https://test-api.k6.io/');

  check(response, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
```

Run the test:
```bash
k6 run test.js
```

Generate HTML report:
```bash
k6 run --out web-dashboard=report.html test.js
```

## Common Issues

### Issue: "k6: command not found"

**Solution**: k6 is not in your PATH. Either:
1. Reinstall using a package manager (Homebrew, APT, Chocolatey)
2. Add k6's installation directory to PATH
3. Set `K6_BIN_PATH` in `worker/.env` with the full path

### Issue: Permission denied

**Solution**: Make k6 executable:
```bash
chmod +x /usr/local/bin/k6
```

### Issue: Different versions between local and Docker

**Recommendation**: Keep the same version for consistency.

Current Docker version: **v0.49.0**

To install the same version locally:
```bash
# macOS (Homebrew)
brew install k6@0.49.0

# Linux (direct download - use the specific version URL)
curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz -o k6.tar.gz
```

## Path Handling in Code

The worker service automatically handles path differences:

```typescript
// In K6ExecutionService constructor
if (configuredPath) {
  this.k6BinaryPath = configuredPath;  // Use explicit path from env
} else {
  this.k6BinaryPath = process.env.NODE_ENV === 'production'
    ? '/usr/local/bin/k6'  // Docker
    : 'k6';                 // Local dev (in PATH)
}
```

This means:
- ✅ **Docker**: Uses `/usr/local/bin/k6`
- ✅ **Local Dev**: Uses `k6` from PATH
- ✅ **Custom**: Set `K6_BIN_PATH` env var

## Next Steps

After installation:
1. Verify k6 works: `k6 version`
2. Start the worker: `cd worker && npm run start:dev`
3. The worker will automatically find k6 in your PATH
4. Check worker logs to confirm k6 binary path is correct

## Resources

- [k6 Official Installation Docs](https://k6.io/docs/get-started/installation/)
- [k6 GitHub Releases](https://github.com/grafana/k6/releases)
- [k6 Documentation](https://k6.io/docs/)
