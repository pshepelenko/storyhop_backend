import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeasonsService } from '../seasons/seasons.service';

async function main() {
  const [seasonId, episodeNumberRaw] = process.argv.slice(2);
  const episodeNumber = Number(episodeNumberRaw);
  if (!seasonId || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    throw new Error('Usage: npm run repair:prepared-episode-media -- <seasonId> <episodeNumber>');
  }

  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    console.log(JSON.stringify(await app.get(SeasonsService).repairUsedPreparedEpisodeMedia(seasonId, episodeNumber)));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
