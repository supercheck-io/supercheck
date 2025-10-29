import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
const postgres = require('postgres');
import * as schema from './schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  public db: PostgresJsDatabase<typeof schema>;

  onModuleInit() {
    this.logger.log('Initializing database connection...');
    try {
      // Initialize with proper connection pooling
      const queryClient = postgres(process.env.DATABASE_URL!, {
        max: parseInt(process.env.DB_POOL_MAX || '10', 10), // Default: 10 connections
        idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30', 10), // Default: 30 seconds
        connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10', 10), // Default: 10 seconds
        max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || '1800', 10), // Default: 30 minutes (in seconds)
      });
      this.db = drizzle(queryClient, { schema });
      this.logger.log('Database connection initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize database connection', error);
      throw error;
    }
  }

  /**
   * Gets project information by ID
   * @param projectId The project ID
   */
  async getProjectById(projectId: string): Promise<any> {
    try {
      const project = await this.db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      return project;
    } catch (error) {
      this.logger.error(
        `Failed to get project ${projectId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Gets test information by ID for synthetic monitor execution
   * @param testId The test ID
   * @returns Test record including script, title, and type
   */
  async getTestById(testId: string): Promise<{
    id: string;
    title: string;
    script: string;
    type: string;
    organizationId: string | null;
    projectId: string | null;
  } | null> {
    try {
      const test = await this.db.query.tests.findFirst({
        where: eq(schema.tests.id, testId),
        columns: {
          id: true,
          title: true,
          script: true,
          type: true,
          organizationId: true,
          projectId: true,
        },
      });
      return test || null;
    } catch (error) {
      this.logger.error(
        `Failed to get test ${testId}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
