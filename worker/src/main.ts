// IMPORTANT: Instrumentation MUST be imported first, before any other imports
// This ensures OpenTelemetry can properly instrument all dependencies
import './observability/instrumentation';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  // Create the application with buffer logs until logger is ready
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino logger for the entire application
  app.useLogger(app.get(Logger));

  // Start the server
  const port = process.env.PORT ?? 8000;
  await app.listen(port);

  // Log startup message using Pino
  const logger = app.get(Logger);
  logger.log(`Worker service running on port ${port}`, 'Bootstrap');
}
void bootstrap();
