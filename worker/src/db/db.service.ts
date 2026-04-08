import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { eq } from 'drizzle-orm';
import { DB_PROVIDER_TOKEN } from './db.constants';

@Injectable()
export class DbService {
  private readonly logger = new Logger(DbService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    public readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    this.logger.log('DbService initialized (shared connection pool).');
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

  /**
   * Gets all variables for a project
   * Used for resolving variables in synthetic monitor execution
   * @param projectId The project ID
   * @returns Array of project variable records
   */
  async getProjectVariables(projectId: string): Promise<
    {
      key: string;
      value: string;
      encryptedValue: string | null;
      isSecret: boolean;
      type: string | null;
      fileName: string | null;
      fileSize: number | null;
      mimeType: string | null;
      storagePath: string | null;
    }[]
  > {
    try {
      const variables = await this.db.query.projectVariables.findMany({
        where: eq(schema.projectVariables.projectId, projectId),
        columns: {
          key: true,
          value: true,
          encryptedValue: true,
          isSecret: true,
          type: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          storagePath: true,
        },
      });
      return variables;
    } catch (error) {
      this.logger.error(
        `Failed to get project variables for ${projectId}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
