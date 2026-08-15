import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeasonsService } from '../seasons/seasons.service';

async function main() {
  // Maintenance commands must not start the long-lived worker in this process.
  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await app.get(SeasonsService).backfillMissingSeasonTitles();
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
