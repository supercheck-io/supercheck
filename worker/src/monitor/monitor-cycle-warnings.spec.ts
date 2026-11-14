jest.mock('./mcp-cycle-evaluation', () => ({ evaluateMcpCycle: jest.fn() }));
jest.mock('./ai-endpoint-warnings', () => ({
  evaluateAiEndpointWarnings: jest.fn(),
}));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { evaluateMcpCycle } from './mcp-cycle-evaluation';
import { evaluateCycleWarnings } from './monitor-cycle-warnings';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';

const db = {} as PostgresJsDatabase<typeof schema>;
const up = { isUp: true, responseTimeMs: 1, details: {} };
const cycleAt = new Date('2026-01-01T00:00:00Z');
const down = { isUp: false, details: {} };

describe('evaluateCycleWarnings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands an MCP monitor only its up results', async () => {
    await evaluateCycleWarnings(
      db,
      { id: 'm', type: 'mcp_server', config: null },
      'c1',
      cycleAt,
      [up, down],
    );
    expect(evaluateMcpCycle).toHaveBeenCalledWith(db, 'm', 'c1', cycleAt, [up]);
    expect(evaluateAiEndpointWarnings).not.toHaveBeenCalled();
  });

  it('hands an AI preset http monitor every result', async () => {
    await evaluateCycleWarnings(
      db,
      { id: 'm', type: 'http_request', config: { aiEndpoint: { model: 'x' } } },
      'c1',
      cycleAt,
      [up, down],
    );
    expect(evaluateAiEndpointWarnings).toHaveBeenCalledWith(
      db,
      'm',
      'c1',
      cycleAt,
      [up, down],
    );
    expect(evaluateMcpCycle).not.toHaveBeenCalled();
  });

  it.each([
    ['a plain http monitor', { type: 'http_request', config: {} }],
    [
      'a website monitor with the preset key',
      { type: 'website', config: { aiEndpoint: { model: 'x' } } },
    ],
    ['a monitor with no config', { type: 'http_request', config: null }],
  ])('does nothing for %s', async (_n, monitor) => {
    await evaluateCycleWarnings(db, { id: 'm', ...monitor }, 'c1', cycleAt, [
      up,
    ]);
    expect(evaluateMcpCycle).not.toHaveBeenCalled();
    expect(evaluateAiEndpointWarnings).not.toHaveBeenCalled();
  });
});

describe('dispatchMonitorWarning', () => {
  it('resolves (debug log only until the warning PR lands)', async () => {
    await expect(
      dispatchMonitorWarning('m', 'mcp_slow', 'reason', 'mcp_slow:c1'),
    ).resolves.toBeUndefined();
  });
});
