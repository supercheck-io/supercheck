import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, LogLevel } from '@nestjs/common';

async function bootstrap() {
  // Only show warnings and errors in production, include logs in development
  const logLevels: LogLevel[] =
    process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  await app.listen(process.env.PORT ?? 8000);

  const logger = new Logger('Bootstrap');
  logger.log(`Worker service running on port ${process.env.PORT ?? 8000}`);
}
void bootstrap();
