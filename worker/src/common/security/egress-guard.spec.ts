import { spawn, spawnSync } from 'child_process';
import { createServer, Server } from 'net';
import { EGRESS_GUARD_SCRIPT } from './egress-guard';

const run = (port: number, boundSeconds: number) =>
  spawnSync(process.execPath, ['-e', EGRESS_GUARD_SCRIPT, `${boundSeconds}`], {
    env: {
      ...process.env,
      KUBERNETES_SERVICE_HOST: '127.0.0.1',
      KUBERNETES_SERVICE_PORT: `${port}`,
    },
    encoding: 'utf8',
  });

describe('EGRESS_GUARD_SCRIPT', () => {
  it('fails closed (78) within the bound when the API address cannot be resolved', () => {
    const r = spawnSync(process.execPath, ['-e', EGRESS_GUARD_SCRIPT, '2'], {
      env: { PATH: process.env.PATH, KUBERNETES_SERVICE_HOST: '' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(78);
  });

  let server: Server;
  let openPort: number;

  beforeAll(async () => {
    server = createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    openPort = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('exits 0 after two blocked probes when the API port is blocked', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    const started = Date.now();
    expect(run(port, 5).status).toBe(0);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('does not pass on a single refusal followed by a reachable API', async () => {
    // A restarting API server refuses once while the policy is still missing.
    const flapping = createServer((s) => s.destroy());
    await new Promise<void>((r) => flapping.listen(0, '127.0.0.1', r));
    const port = (flapping.address() as { port: number }).port;
    await new Promise((r) => flapping.close(r));
    const child = spawn(process.execPath, ['-e', EGRESS_GUARD_SCRIPT, '3'], {
      env: {
        ...process.env,
        KUBERNETES_SERVICE_HOST: '127.0.0.1',
        KUBERNETES_SERVICE_PORT: `${port}`,
      },
    });
    const exited = new Promise<number | null>((r) => child.on('exit', r));
    await new Promise((r) => setTimeout(r, 300));
    await new Promise<void>((r) => flapping.listen(port, '127.0.0.1', r));
    try {
      expect(await exited).toBe(78);
    } finally {
      await new Promise((r) => flapping.close(r));
    }
  });

  it('fails closed with an infrastructure error when still reachable at the bound', () => {
    const result = run(openPort, 2);
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('Infrastructure error');
  });
});
