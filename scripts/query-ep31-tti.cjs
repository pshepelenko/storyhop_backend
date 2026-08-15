const { Client } = require('pg');

const SEASON_ID = process.argv[2] || 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const EPISODE_NUMBER = Number(process.argv[3] || 31);

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
    `SELECT "episodeId", "episodeNumber", title, "chapterText", "illustrationCandidate"
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
    `SELECT "illustrationId", status, "promptPayload", "imageUrl", "updatedAt"
     FROM illustrations WHERE "seasonId" = $1 AND "episodeId" = $2`,
    [SEASON_ID, episode.episodeId],
  );
  const jobRes = await client.query(
    `SELECT status, error, result, "updatedAt"
     FROM generation_jobs
     WHERE "seasonId" = $1 AND "episodeId" = $2 AND "jobType" = 'image_generation'
     ORDER BY "updatedAt" DESC LIMIT 1`,
    [SEASON_ID, episode.episodeId],
  );
  const charsRes = await client.query(
    `SELECT "characterId", "displayName", "internalName", role, "visualDescription", aliases, "needsReview", "createdAt"
     FROM season_characters WHERE "seasonId" = $1 ORDER BY "createdAt"`,
    [SEASON_ID],
  );

  const ttiFromIllustration = illRes.rows[0]?.promptPayload?.ttiPrompt || null;
  const ttiFromJob = jobRes.rows[0]?.result?.ttiPrompt || null;
  const tti = ttiFromIllustration || ttiFromJob;

  const grandmaLike = charsRes.rows.filter((row) => {
    const blob = JSON.stringify(row).toLowerCase();
    return /bab|grandma|grandmother|бабул|granny|elder|sigrid/.test(blob);
  });

  console.log(
    JSON.stringify(
      {
        rosterForEp31: charsRes.rows.map((row) => ({
          displayName: row.displayName,
          internalName: row.internalName,
          role: row.role,
          aliases: row.aliases,
        })),
        episode: {
          episodeId: episode.episodeId,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          illustrationCandidate: episode.illustrationCandidate,
          chapterTextExcerpt: String(episode.chapterText || '').slice(0, 1500),
        },
        illustration: {
          illustrationId: illRes.rows[0]?.illustrationId,
          status: illRes.rows[0]?.status,
          imageUrl: illRes.rows[0]?.imageUrl,
          updatedAt: illRes.rows[0]?.updatedAt,
        },
        job: jobRes.rows[0] || null,
        grandmaLikeCharacters: grandmaLike,
        ttiPrompt: tti,
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
