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

  const ep = await client.query(
    `SELECT "episodeId" FROM episodes WHERE "seasonId" = $1 AND "episodeNumber" = $2`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const episodeId = ep.rows[0]?.episodeId;
  if (!episodeId) {
    console.log('Episode not found');
    await client.end();
    return;
  }

  const jobs = await client.query(
    `SELECT "jobId", "jobType", status, error, "createdAt", "updatedAt"
     FROM generation_jobs
     WHERE "seasonId" = $1 AND "episodeId" = $2 AND "jobType" = 'image_generation'
     ORDER BY "createdAt"`,
    [SEASON_ID, episodeId],
  );

  console.log(JSON.stringify({ episodeId, episodeNumber: EPISODE_NUMBER, imageJobs: jobs.rows }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
