const { Client } = require('pg');

const ILLUSTRATION_ID = 'de4a64bd-bf7f-488d-9b8e-b107b20c38bc';
const EPISODE_ID = '21c70a59-f7fd-42cb-9b40-ccdc1e1d0a48';
const JOB_ID = '87a28a89-dd98-4240-8bb7-3905cd1d10f4';
const IMAGE_URL =
  'http://localhost:3000/storage-proxy?key=images%2Fseasons%2Fc01885b7-21ea-4adb-bac2-e14820a0001f%2Fstorybook%2Fde4a64bd-bf7f-488d-9b8e-b107b20c38bc.png';

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  await client.query(
    `UPDATE illustrations
        SET status = 'ready', "imageUrl" = $2, "updatedAt" = NOW()
      WHERE "illustrationId" = $1`,
    [ILLUSTRATION_ID, IMAGE_URL],
  );

  await client.query(
    `UPDATE storybook_entries
        SET status = 'ready', "updatedAt" = NOW()
      WHERE "illustrationId" = $1`,
    [ILLUSTRATION_ID],
  );

  await client.query(
    `UPDATE generation_jobs
        SET status = 'ready',
            error = NULL,
            result = '{}'::jsonb,
            "updatedAt" = NOW()
      WHERE "jobId" = $1`,
    [JOB_ID],
  );

  console.log(JSON.stringify({ updated: true, illustrationId: ILLUSTRATION_ID, imageUrl: IMAGE_URL }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
