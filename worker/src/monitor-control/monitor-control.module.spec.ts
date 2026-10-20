import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MonitorControlModule } from './monitor-control.module';
import { MonitorControlRootModule } from './monitor-control-root.module';
import { MonitorCycleProcessor } from './monitor-cycle.processor';
import { MonitorCycleService } from './monitor-cycle.service';
import { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { DB_PROVIDER_TOKEN } from '../db/db.constants';
import { ExecutionService } from '../execution/services/execution.service';
import { RedisService } from '../execution/services/redis.service';

describe('MonitorControlModule dependency graph', () => {
  it('builds MonitorAlertService without execution or regional-queue providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        MonitorControlModule,
      ],
    })
      .overrideProvider(DB_PROVIDER_TOKEN)
      .useValue({})
      .compile();

    expect(moduleRef.get(MonitorAlertService)).toBeInstanceOf(
      MonitorAlertService,
    );
    // Starting any of these would bring up execution consumers or cleanup timers.
    expect(() => moduleRef.get(ExecutionService, { strict: false })).toThrow();
    expect(() => moduleRef.get(RedisService, { strict: false })).toThrow();
    await moduleRef.close();
  });

  it('builds the whole control-plane process graph with no execution, queue or HTTP-probe providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MonitorControlRootModule],
    })
      .overrideProvider(DB_PROVIDER_TOKEN)
      .useValue({})
      .compile();
    expect(moduleRef.get(MonitorCycleProcessor)).toBeDefined();
    expect(moduleRef.get(MonitorCycleService)).toBeDefined();
    expect(() => moduleRef.get(ExecutionService, { strict: false })).toThrow();
    expect(() => moduleRef.get(RedisService, { strict: false })).toThrow();
    // compile() never runs onModuleInit, so no timer or port was opened.
    await moduleRef.close();
  });
});
