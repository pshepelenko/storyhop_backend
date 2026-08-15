import { Injectable } from '@nestjs/common';
import { SeasonsService } from '../seasons/seasons.service';

@Injectable()
export class WorkerService {
  private running = false;
  private intervalMs = 10000;

  constructor(private readonly seasonsService: SeasonsService) {}

  async processAllPendingJobs(): Promise<{ processed: number }> {
    if (this.running) {
      return { processed: 0 };
    }
    this.running = true;

    try {
      const seasons = await this.seasonsService.getAllSeasonsForProcessing();
      let processed = 0;

      for (const seasonId of seasons) {
        try {
          const result = await this.seasonsService.processPendingGenerationJobs(seasonId, { limit: 10 });
          processed += (result as any)?.results?.length || 0;
        } catch (error) {
          console.error(`Worker: failed to process jobs for season ${seasonId}:`, error?.message);
        }
      }

      return { processed };
    } finally {
      this.running = false;
    }
  }

  startBackgroundProcessing() {
    console.log('[Worker] Starting background job processor...');
    const tick = async () => {
      try {
        await this.processAllPendingJobs();
      } catch (error) {
        console.error('[Worker] Background processing error:', error?.message);
      }
      setTimeout(tick, this.intervalMs);
    };
    tick();
  }
}
