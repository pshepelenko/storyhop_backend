import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TtsMediaMaintenanceService } from '../audio-metadata/tts-media-maintenance.service';

async function main() {
  process.env.WORKER_ENABLED = 'false';
  const scope = process.argv.includes('--all') ? 'all' : 'demo';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const service = app.get(TtsMediaMaintenanceService);
    console.log(`[normalize-tts-media] ${JSON.stringify(await service.normalize(scope))}`);
  } finally {
    await app.close();
  }
}

void main();
