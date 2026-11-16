jest.mock('./mcp-cycle-evaluation', () => ({ evaluateMcpCycle: jest.fn() }));
jest.mock('./agent-run-warning', () => ({
  evaluateAgentRunWarning: jest.fn(),
}));
jest.mock('./ai-endpoint-warnings', () => ({
  evaluateAiEndpointWarnings: jest.fn(),
}));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import { evaluateAgentRunWarning } from './agent-run-warning';
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { evaluateMcpCycle } from './mcp-cycle-evaluation';
import { evaluateCycleWarnings } from './monitor-cycle-warnings';

const db = {} as PostgresJsDatabase<typeof schema>;
const alerts = { sendWarning: jest.fn() };
const up = { isUp: true, location: 'local', responseTimeMs: 1, details: {} };
const cycleAt = new Date('2026-01-01T00:00:00Z');
const down = { isUp: false, location: 'local', details: {} };

describe('evaluateCycleWarnings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands an MCP monitor only its up results', async () => {
    await evaluateCycleWarnings(
      db,
      alerts,
      { id: 'm', type: 'mcp_server', config: null },
      'c1',
      cycleAt,
      [up, down],
    );
    expect(evaluateMcpCycle).toHaveBeenCalledWith(
      db,
      alerts,
      'm',
      'c1',
      cycleAt,
      [up],
      undefined,
    );
  });

  it('passes the full-row tool input through for an early-closed cycle', async () => {
    const tools = { complete: false, upResults: [up] };
    await evaluateCycleWarnings(
      db,
      alerts,
      { id: 'm', type: 'mcp_server', config: null },
      'c1',
      cycleAt,
      [up],
      tools,
    );
    expect(evaluateMcpCycle).toHaveBeenCalledWith(
      db,
      alerts,
      'm',
      'c1',
      cycleAt,
      [up],
      tools,
    );
    expect(evaluateAiEndpointWarnings).not.toHaveBeenCalled();
  });

  it('hands an AI preset http monitor every result', async () => {
    await evaluateCycleWarnings(
      db,
      alerts,
      { id: 'm', type: 'http_request', config: { aiEndpoint: { model: 'x' } } },
      'c1',
      cycleAt,
      [up, down],
      { complete: true, upResults: [up] },
    );
    expect(evaluateAiEndpointWarnings).toHaveBeenCalledWith(
      db,
      alerts,
      'm',
      'c1',
      cycleAt,
      [up, down],
      { complete: true, upResults: [up] },
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
    await evaluateCycleWarnings(
      db,
      alerts,
      { id: 'm', ...monitor },
      'c1',
      cycleAt,
      [up],
    );
    expect(evaluateMcpCycle).not.toHaveBeenCalled();
    expect(evaluateAiEndpointWarnings).not.toHaveBeenCalled();
  });

  it('hands a synthetic monitor every result for the agent run warning', async () => {
    await evaluateCycleWarnings(
      db,
      alerts,
      { id: 'm', type: 'synthetic_test', config: null },
      'c1',
      cycleAt,
      [down],
    );
    expect(evaluateAgentRunWarning).toHaveBeenCalledWith(db, alerts, 'm', [
      down,
    ]);
    expect(evaluateMcpCycle).not.toHaveBeenCalled();
  });
});
