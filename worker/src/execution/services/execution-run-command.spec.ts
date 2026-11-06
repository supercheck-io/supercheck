/**
 * _executeCommand cleanup: SIGKILL escalation must follow the child's real exit,
 * not `child.killed` (which turns true as soon as any signal is sent).
 */
import { EventEmitter } from 'node:events';
import { spawn } from 'child_process';
import type { ConfigService } from '@nestjs/config';
import { ExecutionService } from './execution.service';

jest.mock('child_process', () => ({ spawn: jest.fn(), execSync: jest.fn() }));

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

function run(child: FakeChild) {
  (spawn as jest.Mock).mockReturnValue(child);
  const service = new ExecutionService(
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
      _executeCommand: (c: string, a: string[]) => Promise<unknown>;
    }
  )._executeCommand('node', ['x.js']);
  // 'error' triggers cleanup while the child is still alive.
  child.emit('error', new Error('boom'));
  return result;
}

describe('ExecutionService._executeCommand kill escalation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('SIGKILLs a child that ignores SIGTERM after the grace period', async () => {
    const child = new FakeChild(); // traps SIGTERM, never exits
    await run(child);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    jest.advanceTimersByTime(2000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
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
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });
});
