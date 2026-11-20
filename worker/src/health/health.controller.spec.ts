import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

describe('HealthController liveness', () => {
  const controller = (alive: boolean) =>
    new HealthController({
      getLivenessStatus: () => ({ status: 'x', alive }),
    } as unknown as HealthService);

  it('answers 200 while alive', () => {
    expect(controller(true).liveness().alive).toBe(true);
  });

  it('answers 503 when a consumer stalled so Kubernetes restarts the pod', () => {
    expect(() => controller(false).liveness()).toThrow(
      ServiceUnavailableException,
    );
  });
});
