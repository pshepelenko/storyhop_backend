import { Controller, Post } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { assertMaintenanceRouteEnabled } from '../security/maintenance-route';

@Controller('worker')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Post('process')
  async triggerProcessing() {
    assertMaintenanceRouteEnabled();
    const result = await this.workerService.processAllPendingJobs();
    return { ...result, timestamp: new Date().toISOString() };
  }
}
