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

  const rows = await client.query(
    `SELECT e."episodeNumber", e."episodeId", e.title,
            i."illustrationId", i.status AS illustration_status, i."imageUrl" IS NOT NULL AS has_image,
            sb."storybookEntryId", sb.status AS storybook_status, sb."illustrationId" AS sb_illustration_id,
            j.status AS job_status, j.error AS job_error
     FROM episodes e
     LEFT JOIN illustrations i ON i."episodeId" = e."episodeId" AND i."seasonId" = e."seasonId"
     LEFT JOIN storybook_entries sb ON sb."episodeId" = e."episodeId" AND sb."seasonId" = e."seasonId"
     LEFT JOIN LATERAL (
       SELECT status, error FROM generation_jobs gj
       WHERE gj."episodeId" = e."episodeId" AND gj."seasonId" = e."seasonId" AND gj."jobType" = 'image_generation'
       ORDER BY gj."updatedAt" DESC LIMIT 1
     ) j ON true
     WHERE e."seasonId" = $1
     ORDER BY e."episodeNumber"`,
    [SEASON_ID],
  );

  console.log(JSON.stringify(rows.rows.filter((r) => r.episodeNumber >= 28), null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
