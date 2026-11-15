import { PgDialect } from 'drizzle-orm/pg-core';
import { isMonitorInMaintenance } from './maintenance';

describe('isMonitorInMaintenance', () => {
  const at = new Date('2026-11-20T01:30:00Z');

  it.each([
    [[{ in_maintenance: true }], true],
    [{ rows: [{ in_maintenance: true }] }, true],
    [[{ in_maintenance: false }], false],
    [[], false],
  ])('reads %j as %s', async (result, expected) => {
    const execute = jest.fn().mockResolvedValue(result);
    await expect(
      isMonitorInMaintenance({ execute }, 'monitor-1', at),
    ).resolves.toBe(expected);
  });

  it('checks windows by stored occurrence and the status-page rule for the monitor at the given time', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    await isMonitorInMaintenance({ execute }, 'monitor-1', at);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toEqual(
      expect.arrayContaining(['monitor-1', at.toISOString()]),
    );
    expect(query.sql).toMatch(/occurrence_ends_at > /);
    expect(query.sql).toMatch(
      /w.cancelled_at IS NULL\s+AND w.occurrence_starts_at/,
    );
    expect(query.sql).toMatch(/sre_service_resources/);
    expect(query.sql).toMatch(/scheduled_until > /);
  });
});
