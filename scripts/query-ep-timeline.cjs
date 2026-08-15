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

  const season = await client.query(
    `SELECT status, "currentEpisodeNumber", "createdAt", "updatedAt" FROM seasons WHERE "seasonId" = $1`,
    [SEASON_ID],
  );
  const ep = await client.query(
    `SELECT "episodeId", "episodeNumber", title, "createdAt", "updatedAt"
     FROM episodes WHERE "seasonId" = $1 AND "episodeNumber" = $2`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const prepared = await client.query(
    `SELECT "preparedEpisodeId", status, "nextEpisodeNumber", "createdAt", "updatedAt"
     FROM prepared_episodes WHERE "seasonId" = $1 AND "nextEpisodeNumber" = $2
     ORDER BY "createdAt"`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const failedSeasonJobs = await client.query(
    `SELECT gj."jobId", e."episodeNumber", gj.status, gj.error, gj."createdAt", gj."updatedAt"
     FROM generation_jobs gj
     LEFT JOIN episodes e ON e."episodeId" = gj."episodeId"
     WHERE gj."seasonId" = $1 AND gj."jobType" = 'image_generation' AND gj.status = 'failed'
     ORDER BY gj."createdAt"`,
    [SEASON_ID],
  );

  console.log(
    JSON.stringify(
      {
        season: season.rows[0],
        episode: ep.rows[0],
        preparedEpisodes: prepared.rows,
        failedImageJobs: failedSeasonJobs.rows,
      },
      null,
      2,
    ),
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
