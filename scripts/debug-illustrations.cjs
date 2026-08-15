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

  const jobs = await client.query(
    `SELECT "jobId", "jobType", status, error, payload, result, "updatedAt"
     FROM generation_jobs
     WHERE "seasonId" = $1 AND "jobType" = 'image_generation'
     ORDER BY "updatedAt" DESC LIMIT 10`,
    [SEASON_ID],
  );
  const illustrations = await client.query(
    `SELECT "illustrationId", "episodeId", status, "imageUrl", "promptPayload", "updatedAt"
     FROM illustrations WHERE "seasonId" = $1 ORDER BY "updatedAt" DESC LIMIT 10`,
    [SEASON_ID],
  );
  const entries = await client.query(
    `SELECT "storybookEntryId", "episodeId", status, "illustrationId", "updatedAt"
     FROM storybook_entries WHERE "seasonId" = $1 ORDER BY "updatedAt" DESC LIMIT 10`,
    [SEASON_ID],
  );
  const hero = await client.query(
    `SELECT "heroReferenceImageUrl", "generationStatus" FROM heroes WHERE "seasonId" = $1`,
    [SEASON_ID],
  );

  console.log(JSON.stringify({ jobs: jobs.rows, illustrations: illustrations.rows, entries: entries.rows, hero: hero.rows[0] }, null, 2));
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
