import { Injectable, Logger, Inject } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from './db.service';

/**
 * Usage Tracker Service for Worker
 * Tracks Playwright and K6 usage and updates organization usage counters
 */
@Injectable()
export class UsageTrackerService {
  private readonly logger = new Logger(UsageTrackerService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Track Playwright execution time
   * Updates local database usage counter
   */
  async trackPlaywrightExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const minutes = Math.ceil(executionTimeMs / 1000 / 60);

      // Update organization's usage counter
      await this.db
        .update(schema.organization)
        .set({
          playwrightMinutesUsed: sql`COALESCE(${schema.organization.playwrightMinutesUsed}, 0) + ${minutes}`,
        })
        .where(eq(schema.organization.id, organizationId));

      this.logger.log(
        `[Usage] Tracked ${minutes} Playwright minutes for org ${organizationId}`,
        metadata,
      );
    } catch (error) {
      // Don't fail the execution if tracking fails
      this.logger.error(
        `[Usage] Failed to track Playwright usage for org ${organizationId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Track K6 load testing execution
   * Calculates VU hours from virtual users and duration
   */
  async trackK6Execution(
    organizationId: string,
    virtualUsers: number,
    durationMs: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      // Calculate VU hours: (VUs * duration in hours)
      const hours = (virtualUsers * durationMs) / 1000 / 60 / 60;
      const vuHours = parseFloat(hours.toFixed(4)); // Round to 4 decimal places

      // Update organization's usage counter
      await this.db
        .update(schema.organization)
        .set({
          k6VuHoursUsed: sql`COALESCE(${schema.organization.k6VuHoursUsed}, 0) + ${vuHours}`,
        })
        .where(eq(schema.organization.id, organizationId));

      this.logger.log(
        `[Usage] Tracked ${vuHours} K6 VU hours for org ${organizationId}`,
        metadata,
      );
    } catch (error) {
      this.logger.error(
        `[Usage] Failed to track K6 usage for org ${organizationId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Track monitor execution (counts as Playwright minutes)
   * Monitors are essentially Playwright tests that run on a schedule
   */
  async trackMonitorExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.trackPlaywrightExecution(organizationId, executionTimeMs, {
      type: 'monitor',
      ...metadata,
    });
  }
}
