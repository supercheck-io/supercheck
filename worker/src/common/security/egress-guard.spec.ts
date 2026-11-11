import { spawnSync } from 'child_process';
import { createServer, Server } from 'net';
import {
  EGRESS_GUARD_COMMAND_PREFIX,
  EGRESS_GUARD_SCRIPT,
} from './egress-guard';

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
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('Infrastructure error');
  });
});

describe('guard isolation from caller env', () => {
  it('ignores NODE_OPTIONS when launched through the command prefix', () => {
    const r = spawnSync(
      '/bin/sh',
      [
        '-c',
        `${EGRESS_GUARD_COMMAND_PREFIX} ${process.execPath} -e 'console.log(process.env.NODE_OPTIONS === undefined)'`,
      ],
      {
        env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
        encoding: 'utf8',
      },
    );
    expect(r.stdout.trim()).toBe('true');
  });
});
