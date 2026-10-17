/**
 * The worker's structured logging contract. Every service calls these helpers,
 * so a change here silently affects every log line operators use to diagnose a
 * production incident: delegation shape, error serialisation and level choice.
 */
import type { PinoLogger } from 'nestjs-pino';
import { LoggerService } from './logger.service';

type PinoSpy = {
  setContext: jest.Mock;
  trace: jest.Mock;
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  fatal: jest.Mock;
};

function createPino(): PinoSpy {
  return {
    setContext: jest.fn(),
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

function createLogger() {
  const pino = createPino();
  return { pino, logger: new LoggerService(pino as unknown as PinoLogger) };
}

describe('LoggerService', () => {
  it('applies the context to the underlying pino logger', () => {
    const { pino, logger } = createLogger();

    logger.setContext('ExecutionService');

    expect(pino.setContext).toHaveBeenCalledWith('ExecutionService');
  });

  it.each(['trace', 'debug', 'info', 'warn'] as const)(
    'delegates %s with the message alone when no data is supplied',
    (level) => {
      const { pino, logger } = createLogger();

      logger[level]('message');

      expect(pino[level]).toHaveBeenCalledWith('message');
    },
  );

  it.each(['trace', 'debug', 'info', 'warn'] as const)(
    'delegates %s with structured data first when data is supplied',
    (level) => {
      const { pino, logger } = createLogger();

      logger[level]('message', { runId: 'run-1' });

      expect(pino[level]).toHaveBeenCalledWith({ runId: 'run-1' }, 'message');
    },
  );

  it('serialises an Error into a structured err field without losing the stack', () => {
    const { pino, logger } = createLogger();
    const error = new Error('container exited');

    logger.error('Execution failed', error, { runId: 'run-1' });

    expect(pino.error).toHaveBeenCalledWith(
      {
        runId: 'run-1',
        err: { message: 'container exited', stack: error.stack, name: 'Error' },
      },
      'Execution failed',
    );
  });

  it('keeps a non-Error thrown value under an error field', () => {
    const { pino, logger } = createLogger();

    logger.error('Execution failed', 'string failure');

    expect(pino.error).toHaveBeenCalledWith(
      { error: 'string failure' },
      'Execution failed',
    );
  });

  it('logs an error without any error payload when none is supplied', () => {
    const { pino, logger } = createLogger();

    logger.error('Execution failed');

    expect(pino.error).toHaveBeenCalledWith({}, 'Execution failed');
  });

  it('serialises fatal errors the same way as errors', () => {
    const { pino, logger } = createLogger();
    const error = new Error('out of memory');

    logger.fatal('worker is exiting', error, { attempt: 3 });

    expect(pino.fatal).toHaveBeenCalledWith(
      {
        attempt: 3,
        err: { message: 'out of memory', stack: error.stack, name: 'Error' },
      },
      'worker is exiting',
    );
  });

  it('returns the operation start time and announces the operation', () => {
    const { pino, logger } = createLogger();

    const startTime = logger.startOperation('monitor-check', {
      monitorId: 'monitor-1',
    });

    expect(typeof startTime).toBe('number');
    expect(pino.info).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: 'monitor-1',
        operationName: 'monitor-check',
        startTime,
      }),
      'Starting operation: monitor-check',
    );
  });

  it('records a successful operation completion at info level', () => {
    const { pino, logger } = createLogger();
    jest.spyOn(Date, 'now').mockReturnValue(1_500);

    logger.endOperation('monitor-check', 1_000, true, {
      monitorId: 'monitor-1',
    });

    expect(pino.info).toHaveBeenCalledWith(
      {
        monitorId: 'monitor-1',
        operationName: 'monitor-check',
        duration: 500,
        success: true,
      },
      'Completed operation: monitor-check',
    );
    jest.restoreAllMocks();
  });

  it('records a failed operation completion at warn level', () => {
    const { pino, logger } = createLogger();
    jest.spyOn(Date, 'now').mockReturnValue(2_000);

    logger.endOperation('monitor-check', 1_000, false);

    expect(pino.warn).toHaveBeenCalledWith(
      { operationName: 'monitor-check', duration: 1_000, success: false },
      'Failed operation: monitor-check',
    );
    jest.restoreAllMocks();
  });

  it.each([
    ['started', 'info', 'Job started: cleanup'],
    ['completed', 'info', 'Job completed: cleanup'],
  ] as const)('maps a %s job status to %s', (status, level, message) => {
    const { pino, logger } = createLogger();

    logger.logJobExecution('cleanup', 'job-1', status);

    expect(pino[level]).toHaveBeenCalledWith(
      { jobName: 'cleanup', jobId: 'job-1', status },
      message,
    );
  });

  it('maps a failed job status to error with the job metadata', () => {
    const { pino, logger } = createLogger();

    logger.logJobExecution('cleanup', 'job-1', 'failed', { attempt: 2 });

    expect(pino.error).toHaveBeenCalledWith(
      { attempt: 2, jobName: 'cleanup', jobId: 'job-1', status: 'failed' },
      'Job failed: cleanup',
    );
  });

  describe('logQuery', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('logs queries only in development', () => {
      const { pino, logger } = createLogger();

      process.env.NODE_ENV = 'development';
      logger.logQuery('select 1', 12, { table: 'runs' });
      expect(pino.debug).toHaveBeenCalledWith(
        { table: 'runs', query: 'select 1', duration: 12 },
        'Database query',
      );

      pino.debug.mockClear();
      process.env.NODE_ENV = 'production';
      logger.logQuery('select 1', 12);
      expect(pino.debug).not.toHaveBeenCalled();
    });
  });

  describe('logApiCall', () => {
    it('warns for error responses', () => {
      const { pino, logger } = createLogger();

      logger.logApiCall('POST', 'https://api.test/hook', 503, 40, {
        provider: 'slack',
      });

      expect(pino.warn).toHaveBeenCalledWith(
        {
          provider: 'slack',
          method: 'POST',
          url: 'https://api.test/hook',
          statusCode: 503,
          duration: 40,
        },
        'API call failed: POST https://api.test/hook',
      );
      expect(pino.debug).not.toHaveBeenCalled();
    });

    it('logs successful calls at debug level', () => {
      const { pino, logger } = createLogger();

      logger.logApiCall('GET', 'https://api.test/hook', 200, 12);

      expect(pino.debug).toHaveBeenCalledWith(
        {
          method: 'GET',
          url: 'https://api.test/hook',
          statusCode: 200,
          duration: 12,
        },
        'API call: GET https://api.test/hook',
      );
      expect(pino.warn).not.toHaveBeenCalled();
    });
  });
});
