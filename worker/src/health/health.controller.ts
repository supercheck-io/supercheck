import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const health = await this.healthService.getHealthStatus();
    if (health.status !== 'healthy') {
      throw new HttpException(health, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }

  @Get('ready')
  async readiness() {
    const result = await this.healthService.getReadinessStatus();
    if (!result.ready) {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Get('live')
  liveness() {
    return this.healthService.getLivenessStatus();
  }
}
