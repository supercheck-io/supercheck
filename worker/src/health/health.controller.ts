import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const health = await this.healthService.getHealthStatus();
    if (health.status !== 'healthy') {
      throw new ServiceUnavailableException(health);
    }
    return health;
  }

  @Get('ready')
  async readiness() {
    const readiness = await this.healthService.getReadinessStatus();

    if (!readiness.ready) {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }

  @Get('live')
  liveness() {
    const liveness = this.healthService.getLivenessStatus();
    if (!liveness.alive) throw new ServiceUnavailableException(liveness);
    return liveness;
  }
}
