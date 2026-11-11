import { spawnSync } from 'child_process';
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
  let server: Server;
  let openPort: number;

  beforeAll(async () => {
    server = createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    openPort = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('exits 0 immediately when the API port is blocked', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    const started = Date.now();
    expect(run(port, 5).status).toBe(0);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('fails closed with an infrastructure error when still reachable at the bound', () => {
    const result = run(openPort, 2);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Infrastructure error');
  });
});
