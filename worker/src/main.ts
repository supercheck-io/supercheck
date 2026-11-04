import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { startPrivateAgentRunner } from './private-agent/private-agent-runner';

import { assertSecretKeyUsable } from './common/security/secret-crypto';
import { isCloudWorkerRuntime } from './common/runtime-mode';
import { initSentry } from './common/sentry-reporter';

async function bootstrap() {
  // No-op unless SENTRY_DSN is set and SELF_HOSTED is not true.
  initSentry();
  // Cloud production must not boot on the compose placeholder key.
  if (isCloudWorkerRuntime()) assertSecretKeyUsable();
  // Create the application with buffer logs until logger is ready
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino logger for the entire application
  app.useLogger(app.get(Logger));

  // Without this, Nest never installs SIGTERM/SIGINT listeners and every
  // onModuleDestroy hook (queue workers, heartbeat, redis, executors) is skipped.
  app.enableShutdownHooks();

  // Start the server
  const port = process.env.PORT ?? 8000;
  await app.listen(port);

  // Log startup message using Pino
  const logger = app.get(Logger);
  logger.log(`Worker service running on port ${port}`, 'Bootstrap');
}
if (process.env.SUPERCHECK_RUNTIME_MODE === 'private-agent') {
  void startPrivateAgentRunner();
} else {
  void bootstrap();
}
