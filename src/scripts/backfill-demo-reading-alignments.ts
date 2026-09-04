import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoStoryService } from '../demo-story/demo-story.service';

async function main() {
  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    console.log(JSON.stringify(await app.get(DemoStoryService).backfillReadingAlignments()));
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
