import {
  MonitorControlHealthServer,
  renderMetrics,
} from './monitor-control-health.server';
import type {
  MonitorCycleProcessor,
  ProcessorSnapshot,
} from './monitor-cycle.processor';

const snapshot = (
  overrides: Partial<ProcessorSnapshot> = {},
): ProcessorSnapshot => ({
  started: true,
  intervalMs: 2000,
  lastTickAt: 1_000_000,
  lastSuccessAt: 1_000_000,
  consecutiveFailures: 0,
  arrivalLagSeconds: 3.14,
  overdueSeconds: 0,
  unnotifiedClosed: 2,
  closed: { closed: 4, superseded: 1 },
  notifyFailures: 1,
  cycleFailures: 0,
  abortedCycles: 0,
  retentionDeleted: 0,
  ...overrides,
});

const serverFor = (s: ProcessorSnapshot) =>
  new MonitorControlHealthServer({
    snapshot: () => s,
  } as unknown as MonitorCycleProcessor);

describe('control-plane readiness', () => {
  it('is not ready before the first successful tick', () => {
    expect(
      serverFor(snapshot({ lastSuccessAt: null })).isReady(1_000_000),
    ).toBe(false);
    expect(serverFor(snapshot({ started: false })).isReady(1_000_000)).toBe(
      false,
    );
  });
  it('is ready while ticks succeed and not ready once the loop stalls', () => {
    const server = serverFor(snapshot());
    expect(server.isReady(1_005_000)).toBe(true);
    expect(server.isReady(1_000_000 + 31_000)).toBe(false);
  });
  it('is not ready after repeated tick failures', () => {
    expect(
      serverFor(snapshot({ consecutiveFailures: 5 })).isReady(1_001_000),
    ).toBe(false);
  });
});

describe('control-plane metrics', () => {
  it('exposes heartbeat, lag, overdue, backlog and counters', () => {
    const text = renderMetrics(snapshot());
    expect(text).toContain(
      'supercheck_monitor_control_heartbeat_timestamp_seconds 1000',
    );
    expect(text).toContain('supercheck_monitor_cycle_arrival_lag_seconds 3.1');
    expect(text).toContain('supercheck_monitor_cycle_overdue_seconds 0.0');
    expect(text).toContain('supercheck_monitor_cycle_unnotified_closed 2');
    expect(text).toContain(
      'supercheck_monitor_cycle_closed_total{outcome="closed"} 4',
    );
    expect(text).toContain('supercheck_monitor_cycle_notify_failures_total 1');
    expect(text).toContain('supercheck_monitor_cycle_aborted_total 0');
  });
});

describe('control-plane liveness', () => {
  it('stays alive while starting and while progress is recent', () => {
    expect(
      serverFor(snapshot({ lastSuccessAt: null })).isAlive(1_000_000),
    ).toBe(true);
    expect(serverFor(snapshot()).isAlive(1_000_000 + 60_000)).toBe(true);
  });
  it('reports a wedged loop so Kubernetes restarts the pod', () => {
    expect(serverFor(snapshot()).isAlive(1_000_000 + 301_000)).toBe(false);
  });
});
