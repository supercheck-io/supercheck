/**
 * _executeCommand cleanup: SIGKILL escalation must follow the child's real exit,
 * not `child.killed` (which turns true as soon as any signal is sent).
 */
import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';

jest.mock('child_process', () => ({ spawn: jest.fn(), execSync: jest.fn() }));

// `isWindows` is a module-level constant, so load a fresh copy per platform.
let mods: {
  ExecutionService: typeof import('./execution.service').ExecutionService;
  spawn: jest.Mock;
  execSync: jest.Mock;
};
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
function load(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  jest.isolateModules(() => {
    const cp = require('child_process');
    const svc = require('./execution.service');
    mods = {
      ExecutionService: svc.ExecutionService,
      spawn: cp.spawn,
      execSync: cp.execSync,
    };
  });
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  // Mirrors Node: `killed` flips on the first signal regardless of exit.
  kill = jest.fn(() => {
    this.killed = true;
    return true;
  });
}

function start(child: FakeChild, options: { timeout?: number } = {}) {
  mods.spawn.mockReturnValue(child);
  const service = new mods.ExecutionService(
    { get: (_k: string, d?: string) => d } as unknown as ConfigService,
    ...(Array(9).fill({}) as [
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
    ]),
  );
  const result = (
    service as unknown as {
      _executeCommand: (
        c: string,
        a: string[],
        o?: { timeout?: number },
      ) => Promise<unknown>;
    }
  )._executeCommand('node', ['x.js'], options);
  return result;
}

function run(child: FakeChild) {
  const result = start(child);
  // 'error' triggers cleanup while the child is still alive.
  child.emit('error', new Error('boom'));
  return result;
}

describe('ExecutionService._executeCommand kill escalation', () => {
  let killSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    load('linux');
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', realPlatform);
    jest.useRealTimers();
  });

  it('SIGKILLs a child that ignores SIGTERM after the grace period', async () => {
    const child = new FakeChild(); // traps SIGTERM, never exits
    await run(child);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    // Escalation kills the whole process group, not just the child.
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('falls back to the single pid when the process group is gone', async () => {
    killSpy.mockImplementation((pid: number) => {
      if (pid < 0) throw new Error('ESRCH');
      return true;
    });
    await run(new FakeChild());
    jest.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGKILL');
  });

  it('does not throw when both group and pid kills fail', async () => {
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });
    await run(new FakeChild());
    expect(() => jest.advanceTimersByTime(2000)).not.toThrow();
  });

  it('kills the process tree on timeout', async () => {
    const child = new FakeChild();
    const result = start(child, { timeout: 1000 });
    jest.advanceTimersByTime(1000);
    await expect(result).resolves.toMatchObject({ success: false });
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('uses taskkill on Windows instead of process.kill', async () => {
    load('win32');
    await run(new FakeChild());
    jest.advanceTimersByTime(2000);
    expect(mods.execSync).toHaveBeenCalledWith('taskkill /pid 4242 /t /f', {
      stdio: 'ignore',
    });
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('clears the kill timer on close alone', async () => {
    const child = new FakeChild();
    await run(child);
    const armed = jest.getTimerCount();
    child.signalCode = 'SIGTERM';
    child.emit('close', null);
    expect(jest.getTimerCount()).toBe(armed - 1);

    jest.advanceTimersByTime(5000);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('sends no SIGKILL and clears the timer when the child exits after SIGTERM', async () => {
    const child = new FakeChild();
    await run(child);
    const armed = jest.getTimerCount(); // includes the kill timer
    // Node reports the exit asynchronously, after the signal was sent.
    child.signalCode = 'SIGTERM';
    child.emit('exit', null, 'SIGTERM');
    expect(jest.getTimerCount()).toBe(armed - 1); // kill timer cleared

    jest.advanceTimersByTime(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('does not signal a child that already exited', async () => {
    const child = new FakeChild();
    child.exitCode = 0;
    await run(child);

    jest.advanceTimersByTime(5000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });
});
