/**
 * Queue Alerting Controller
 *
 * Exposes endpoints for queue metrics and alerts
 */

import { Controller, Get, Query } from '@nestjs/common';
import { QueueAlertingService } from './queue-alerting.service';
import {
  QueueAlert,
  QueueAlertingConfig,
  QueueMetrics,
} from './queue-alerting.types';

interface MetricsResponse {
  queues: Record<string, QueueMetrics | null>;
  timestamp: string;
}

interface AlertsResponse {
  active: QueueAlert[];
  history: QueueAlert[];
  timestamp: string;
}

@Controller('queue-alerting')
export class QueueAlertingController {
  constructor(private readonly alertingService: QueueAlertingService) {}

  /**
   * Get current queue metrics
   */
  @Get('metrics')
  getMetrics(): MetricsResponse {
    const metricsMap = this.alertingService.getMetrics();
    const queues: Record<string, QueueMetrics | null> = {};

    for (const [name, history] of metricsMap) {
      // Return the most recent metrics
      queues[name] = history.length > 0 ? history[history.length - 1] : null;
    }

    return {
      queues,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get active and historical alerts
   */
  @Get('alerts')
  getAlerts(@Query('limit') limit?: string): AlertsResponse {
    const historyLimit = limit ? parseInt(limit, 10) : 100;

    return {
      active: this.alertingService.getActiveAlerts(),
      history: this.alertingService.getAlertHistory(historyLimit),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get alerting configuration (for debugging)
   */
  @Get('config')
  getConfig(): QueueAlertingConfig {
    return this.alertingService.getConfig();
  }
}
