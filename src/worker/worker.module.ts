import { Module, OnModuleInit } from '@nestjs/common';
import { SeasonsModule } from '../seasons/seasons.module';
import { SeasonsService } from '../seasons/seasons.service';
import { WorkerService } from './worker.service';
import { WorkerController } from './worker.controller';

@Module({
  imports: [SeasonsModule],
  providers: [WorkerService],
  controllers: [WorkerController],
})
export class WorkerModule implements OnModuleInit {
  constructor(
    private readonly workerService: WorkerService,
    private readonly seasonsService: SeasonsService,
  ) {}

  async onModuleInit() {
    if (process.env.WORKER_ENABLED !== 'false') {
      const recovered = await this.seasonsService.recoverOrphanedJobsOnStartup();
      if (recovered > 0) {
        console.log(`[Worker] Startup recovered ${recovered} orphaned processing jobs`);
      }
      this.workerService.startBackgroundProcessing();
    }
  }
}
