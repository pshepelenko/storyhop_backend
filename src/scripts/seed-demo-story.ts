import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoStoryService } from '../demo-story/demo-story.service';

async function main() {
  // Seeding text records is deterministic and must not trigger background generation.
  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const demoStory = app.get(DemoStoryService);
    console.log(JSON.stringify(await demoStory.seedTextContent()));
  } finally {
    await app.close();
  }
}

void main();
