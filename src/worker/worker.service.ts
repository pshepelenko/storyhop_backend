import { Injectable } from '@nestjs/common';
import { SeasonsService } from '../seasons/seasons.service';
import { LlmDiagnosticsService } from '../llm-diagnostics/llm-diagnostics.service';

@Injectable()
export class WorkerService {
  private running = false;
  private intervalMs = 10000;
  private lastDiagnosticsPurgeAt = 0;

  constructor(
    private readonly seasonsService: SeasonsService,
    private readonly llmDiagnostics: LlmDiagnosticsService,
  ) {}

  async processAllPendingJobs(): Promise<{ processed: number; reconciled: number }> {
    if (this.running) {
      return { processed: 0, reconciled: 0 };
    }
    this.running = true;

    try {
      if (Date.now() - this.lastDiagnosticsPurgeAt >= 24 * 60 * 60 * 1000) {
        await this.llmDiagnostics.purgeExpired();
        this.lastDiagnosticsPurgeAt = Date.now();
      }
      const reconciled = await this.seasonsService.reconcileStaleIllustrationUnlocks();
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

      return { processed, reconciled };
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
