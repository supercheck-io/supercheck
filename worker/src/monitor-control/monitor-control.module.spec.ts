import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MonitorControlModule } from './monitor-control.module';
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
});
