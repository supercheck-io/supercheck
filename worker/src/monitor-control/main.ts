import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { MonitorControlRootModule } from './monitor-control-root.module';

/**
 * Control-plane entrypoint: closes monitor check cycles and owns their notification.
 * Runs from the existing worker image with `node dist/src/monitor-control/main.js`.
 * It starts no execution consumers, regional queue workers or cleanup timers.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(
    MonitorControlRootModule,
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  // SIGTERM lets the processor finish its in-flight closure transaction before exit.
  app.enableShutdownHooks();
}

void bootstrap();
