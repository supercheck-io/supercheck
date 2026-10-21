import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { MonitorCycleProcessor } from './monitor-cycle.processor';
import { controlPlaneConfigProblem } from './billing-hold.service';

/** Liveness, readiness and Prometheus metrics for the control plane (no framework HTTP stack). */
@Injectable()
export class MonitorControlHealthServer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MonitorControlHealthServer.name);
  private server: Server | null = null;

  constructor(private readonly processor: MonitorCycleProcessor) {}

  onModuleInit(): void {
    const port = Number.parseInt(
      process.env.MONITOR_CONTROL_PORT ?? process.env.PORT ?? '8000',
      10,
    );
    this.server = createServer((req, res) => {
      const snapshot = this.processor.snapshot();
      if (req.url === '/health/live') {
        const alive = this.isAlive();
        res.writeHead(alive ? 200 : 503).end(alive ? 'ok' : 'stalled');
      } else if (req.url === '/health/ready') {
        const problem = controlPlaneConfigProblem();
        const ready = !problem && this.isReady();
        res
          .writeHead(ready ? 200 : 503)
          .end(ready ? 'ready' : `not ready${problem ? `: ${problem}` : ''}`);
      } else if (req.url === '/metrics') {
        res
          .writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
          .end(renderMetrics(snapshot));
      } else {
        res.writeHead(404).end();
      }
    });
    this.server.listen(port, '0.0.0.0', () =>
      this.logger.log(`Monitor control plane health on :${port}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  /**
   * Liveness follows progress, not just the process: a loop that has not completed any work for
   * several minutes is wedged (a hung dependency) and a restart is the only recovery.
   */
  isAlive(now = Date.now()): boolean {
    const s = this.processor.snapshot();
    if (!s.started || s.lastSuccessAt === null) return true; // startupProbe covers the first tick
    return now - s.lastSuccessAt < Math.max(300_000, s.intervalMs * 60);
  }

  /** Ready only while ticks keep succeeding; a stalled loop must stop receiving traffic/rollouts. */
  isReady(now = Date.now()): boolean {
    const s = this.processor.snapshot();
    if (!s.started || s.lastSuccessAt === null) return false;
    return (
      s.consecutiveFailures < 5 &&
      now - s.lastSuccessAt < Math.max(30_000, s.intervalMs * 5)
    );
  }
}

export function renderMetrics(
  s: ReturnType<MonitorCycleProcessor['snapshot']>,
): string {
  const lines = [
    '# TYPE supercheck_monitor_control_heartbeat_timestamp_seconds gauge',
    `supercheck_monitor_control_heartbeat_timestamp_seconds ${((s.lastSuccessAt ?? 0) / 1000).toFixed(0)}`,
    '# TYPE supercheck_monitor_cycle_arrival_lag_seconds gauge',
    `supercheck_monitor_cycle_arrival_lag_seconds ${s.arrivalLagSeconds.toFixed(1)}`,
    '# TYPE supercheck_monitor_cycle_overdue_seconds gauge',
    `supercheck_monitor_cycle_overdue_seconds ${s.overdueSeconds.toFixed(1)}`,
    '# TYPE supercheck_monitor_cycle_unnotified_closed gauge',
    `supercheck_monitor_cycle_unnotified_closed ${s.unnotifiedClosed}`,
    '# TYPE supercheck_monitor_cycle_tick_failures gauge',
    `supercheck_monitor_cycle_tick_failures ${s.consecutiveFailures}`,
    '# TYPE supercheck_monitor_cycle_closed_total counter',
    ...Object.entries(s.closed).map(
      ([outcome, count]) =>
        `supercheck_monitor_cycle_closed_total{outcome="${outcome}"} ${count}`,
    ),
    '# TYPE supercheck_monitor_cycle_notify_failures_total counter',
    `supercheck_monitor_cycle_notify_failures_total ${s.notifyFailures}`,
    '# TYPE supercheck_monitor_cycle_close_failures_total counter',
    `supercheck_monitor_cycle_close_failures_total ${s.cycleFailures}`,
  ];
  return lines.join('\n') + '\n';
}
