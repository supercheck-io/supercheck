import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const postgres = require('postgres');
import * as schema from './schema';
import { getSSLConfig } from './db-ssl';
import { DB_PROVIDER_TOKEN } from './db.constants';
import { DbService } from './db.service';

/**
 * Shared Drizzle ORM provider — creates a SINGLE connection pool for the
 * entire worker process. All modules (Execution, K6, Monitor, Health) share
 * this pool through NestJS dependency injection.
 *
 * Connection pool sizing:
 *   DB_POOL_MAX × number_of_worker_replicas < PgBouncer client limit
 *   Default: 10 connections per worker replica
 */
const drizzleProvider: Provider = {
  provide: DB_PROVIDER_TOKEN,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set!');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const client = postgres(connectionString, {
      ssl: getSSLConfig(),
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30', 10),
      connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10', 10),
      max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || '1800', 10),
      prepare:
        process.env.DB_PREPARE != null
          ? process.env.DB_PREPARE !== 'false'
          : process.env.NODE_ENV === 'production',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return drizzle(client, { schema });
  },
};

@Module({
  providers: [drizzleProvider, DbService],
  exports: [drizzleProvider, DbService],
})
export class DbModule {}
