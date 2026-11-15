import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';

const row = {
  id: 'm1',
  name: 'Docs MCP',
  type: 'mcp_server',
  target: 'https://mcp.example.com/mcp',
  projectId: 'p1',
  alertConfig: { enabled: true },
  deletingAt: null,
};

function dbReturning(rows: unknown[] | Error) {
  const limit = jest.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const where = jest.fn(() => ({ limit }));
  return {
    db: {
      select: jest.fn(() => ({ from: () => ({ where }) })),
    } as unknown as PostgresJsDatabase<typeof schema>,
    where,
  };
}

describe('dispatchMonitorWarning', () => {
  it('sends the warning with the live monitor row read now', async () => {
    const { db, where } = dbReturning([row]);
    const alerts = { sendWarning: jest.fn().mockResolvedValue({}) };
    await dispatchMonitorWarning(
      db,
      alerts,
      'm1',
      'mcp_slow',
      'slow',
      'mcp_slow:c1',
    );
    expect(where).toHaveBeenCalledTimes(1);
    expect(alerts.sendWarning).toHaveBeenCalledWith(
      row,
      'mcp_slow',
      'slow',
      'mcp_slow:c1',
    );
  });

  it('sends nothing when the monitor is gone or being deleted', async () => {
    const { db } = dbReturning([]);
    const alerts = { sendWarning: jest.fn() };
    await dispatchMonitorWarning(
      db,
      alerts,
      'm1',
      'mcp_slow',
      'r',
      'mcp_slow:c1',
    );
    expect(alerts.sendWarning).not.toHaveBeenCalled();
  });

  it('logs and resolves when the read or the send fails, so later warnings still go out', async () => {
    const alerts = {
      sendWarning: jest.fn().mockRejectedValue(new Error('smtp down')),
    };
    await expect(
      dispatchMonitorWarning(
        dbReturning([row]).db,
        alerts,
        'm1',
        'ai_model_changed',
        'r',
        'ai_model_changed:c1',
      ),
    ).resolves.toBeUndefined();
    await expect(
      dispatchMonitorWarning(
        dbReturning(new Error('db down')).db,
        alerts,
        'm1',
        'ai_model_changed',
        'r',
        'ai_model_changed:c1',
      ),
    ).resolves.toBeUndefined();
  });
});
