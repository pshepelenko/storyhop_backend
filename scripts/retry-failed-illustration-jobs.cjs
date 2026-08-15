const { Client } = require('pg');

const SEASON_ID = process.argv[2] || 'c01885b7-21ea-4adb-bac2-e14820a0001f';

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const failed = await client.query(
    `SELECT "jobId", payload, error
     FROM generation_jobs
     WHERE "seasonId" = $1 AND "jobType" = 'image_generation' AND status = 'failed'`,
    [SEASON_ID],
  );

  if (!failed.rows.length) {
    console.log('No failed image_generation jobs for season', SEASON_ID);
    await client.end();
    return;
  }

  const jobIds = failed.rows.map((row) => row.jobId);
  const illustrationIds = failed.rows
    .map((row) => row.payload?.illustrationId)
    .filter(Boolean);

  await client.query(
    `UPDATE generation_jobs
     SET status = 'pending', error = NULL, "updatedAt" = NOW()
     WHERE "jobId" = ANY($1::uuid[])`,
    [jobIds],
  );

  if (illustrationIds.length) {
    await client.query(
      `UPDATE illustrations
       SET status = 'pending', "updatedAt" = NOW()
       WHERE "illustrationId" = ANY($1::uuid[])`,
      [illustrationIds],
    );
    await client.query(
      `UPDATE storybook_entries
       SET status = 'locked', "updatedAt" = NOW()
       WHERE "illustrationId" = ANY($1::uuid[]) AND status = 'failed'`,
      [illustrationIds],
    );
  }

  console.log(JSON.stringify({ resetJobs: jobIds.length, jobIds, illustrationIds }, null, 2));
  console.log('Now call POST /seasons/' + SEASON_ID + '/jobs/process with {"jobType":"image_generation","limit":10}');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
