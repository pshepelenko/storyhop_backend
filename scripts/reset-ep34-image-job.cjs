const { Client } = require('pg');

const SEASON_ID = 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const EPISODE_NUMBER = 34;

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const episodeRes = await client.query(
    `SELECT "episodeId" FROM episodes WHERE "seasonId" = $1 AND "episodeNumber" = $2 LIMIT 1`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const episodeId = episodeRes.rows[0]?.episodeId;
  if (!episodeId) {
    throw new Error(`Episode ${EPISODE_NUMBER} not found`);
  }

  const jobRes = await client.query(
    `SELECT "jobId", payload
       FROM generation_jobs
      WHERE "seasonId" = $1 AND "episodeId" = $2 AND "jobType" = 'image_generation'
      ORDER BY "updatedAt" DESC
      LIMIT 1`,
    [SEASON_ID, episodeId],
  );
  const job = jobRes.rows[0];
  if (!job) {
    throw new Error(`Image generation job not found for episode ${EPISODE_NUMBER}`);
  }

  const illustrationId = job.payload?.illustrationId;
  if (!illustrationId) {
    throw new Error('Illustration id is missing in job payload');
  }

  await client.query(
    `UPDATE generation_jobs
        SET status = 'pending', error = NULL, result = '{}'::jsonb, "updatedAt" = NOW()
      WHERE "jobId" = $1`,
    [job.jobId],
  );

  await client.query(
    `UPDATE illustrations
        SET status = 'queued', "updatedAt" = NOW()
      WHERE "illustrationId" = $1`,
    [illustrationId],
  );

  await client.query(
    `UPDATE storybook_entries
        SET status = 'queued', "updatedAt" = NOW()
      WHERE "illustrationId" = $1`,
    [illustrationId],
  );

  console.log(JSON.stringify({ jobId: job.jobId, illustrationId, episodeId, reset: true }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
