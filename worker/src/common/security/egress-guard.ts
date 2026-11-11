/**
 * Fail-closed wait run inside every Kubernetes execution pod before user code.
 *
 * k3s programs the `execution-egress` NetworkPolicy asynchronously after pod
 * start, so the Kubernetes API Service is briefly reachable. This script
 * passes only once a TCP connect to it is refused or times out, retrying
 * every second up to argv[1] seconds (default 20). Still reachable at the
 * bound means the isolation contract is not enforced: exit 1, never run user
 * code. A first blocked probe exits immediately. Uses node because the
 * execution image has node but no nc, and /bin/sh has no /dev/tcp.
 */
export const EGRESS_GUARD_SCRIPT = `
const net = require('net');
const dns = require('dns');
const port = Number(process.env.KUBERNETES_SERVICE_PORT) || 443;
const deadline = Date.now() + (Number(process.argv[1]) || 20) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = (host) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
(async () => {
  for (;;) {
    let detail = 'kubernetes API Service still reachable';
    try {
      const host = process.env.KUBERNETES_SERVICE_HOST ||
        (await dns.promises.lookup('kubernetes.default.svc')).address;
      if (!(await reachable(host))) process.exit(0);
    } catch (e) {
      detail = 'cannot resolve kubernetes API Service: ' + e.message;
    }
    if (Date.now() >= deadline) {
      console.error('Infrastructure error: execution network isolation not enforced (' + detail + '); refusing to run user code');
      process.exit(1);
    }
    await sleep(1000);
  }
})();
`;
