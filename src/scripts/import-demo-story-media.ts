import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoStoryService } from '../demo-story/demo-story.service';

async function main() {
  // This is an explicit maintenance operation, never a reader-path action.
  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const demoStory = app.get(DemoStoryService);
    console.log(JSON.stringify(await demoStory.importMediaSnapshot()));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`[import-demo-story-media] ${error?.message || error}`);
  process.exit(1);
});
