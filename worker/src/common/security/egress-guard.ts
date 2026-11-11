/**
 * Fail-closed wait run inside every Kubernetes execution pod before user code.
 *
 * k3s programs the `execution-egress` NetworkPolicy asynchronously after pod
 * start, so the Kubernetes API Service is briefly reachable. This script
 * passes only once a TCP connect to it is refused or times out, retrying
 * every second up to argv[1] seconds (default 20). Still reachable at the
 * bound means the isolation contract is not enforced: exit 78, never run user
 * code. A first blocked probe exits immediately. Uses node because the
 * execution image has node but no nc, and /bin/sh has no /dev/tcp.
 */
/** Default bound (seconds) of the wait; the worker adds it as timeout headroom. */
export const EGRESS_GUARD_MAX_WAIT_MS = 20_000;

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
    s.on('timeout', () => { s.destroy(); resolve('timeout'); });
    s.on('error', (e) =>
      resolve(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES'].includes(e.code) ? false : null));
  });
let timeouts = 0;
(async () => {
  for (;;) {
    let detail = 'kubernetes API Service still reachable';
    try {
      const host = process.env.KUBERNETES_SERVICE_HOST ||
        (await Promise.race([
          dns.promises.lookup('kubernetes.default.svc'),
          sleep(3000).then(() => { throw new Error('DNS lookup timed out'); }),
        ])).address;
      const r = await reachable(host);
      // A lone timeout can be a delayed SYN; require two in a row.
      timeouts = r === 'timeout' ? timeouts + 1 : 0;
      if (r === false || timeouts >= 2) process.exit(0);
      if (r === null) detail = 'probe error, cannot confirm block';
    } catch (e) {
      detail = 'cannot resolve kubernetes API Service: ' + e.message;
    }
    if (Date.now() >= deadline) {
      console.error('Infrastructure error: execution network isolation not enforced (' + detail + '); refusing to run user code');
      process.exit(78);
    }
    await sleep(1000);
  }
})();
`;
