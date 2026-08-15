const { Client } = require('pg');

const SEASON_ID = process.argv[2] || 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const EPISODE_NUMBER = Number(process.argv[3] || 32);

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const epRes = await client.query(
    `SELECT "episodeId", "episodeNumber", title, "illustrationCandidate"
     FROM episodes WHERE "seasonId" = $1 AND "episodeNumber" = $2`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const episode = epRes.rows[0];
  if (!episode) {
    console.log('Episode not found');
    await client.end();
    return;
  }

  const illRes = await client.query(
    `SELECT "illustrationId", status, "imageUrl", "promptPayload", "createdAt", "updatedAt"
     FROM illustrations WHERE "seasonId" = $1 AND "episodeId" = $2`,
    [SEASON_ID, episode.episodeId],
  );
  const sbRes = await client.query(
    `SELECT *
     FROM storybook_entries WHERE "seasonId" = $1 AND "episodeId" = $2`,
    [SEASON_ID, episode.episodeId],
  );
  const jobRes = await client.query(
    `SELECT "jobId", "jobType", status, error, result, "createdAt", "updatedAt"
     FROM generation_jobs
     WHERE "seasonId" = $1 AND "episodeId" = $2
     ORDER BY "updatedAt" DESC`,
    [SEASON_ID, episode.episodeId],
  );
  const preparedRes = await client.query(
    `SELECT "preparedEpisodeId", status, "nextEpisodeNumber", "sourceEpisodeNumber", "updatedAt"
     FROM prepared_episodes WHERE "seasonId" = $1 AND "nextEpisodeNumber" = $2`,
    [SEASON_ID, EPISODE_NUMBER],
  );

  console.log(
    JSON.stringify(
      {
        episode,
        illustration: illRes.rows[0] || null,
        storybookEntry: sbRes.rows[0] || null,
        jobs: jobRes.rows,
        preparedEpisode: preparedRes.rows[0] || null,
      },
      null,
      2,
    ),
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
