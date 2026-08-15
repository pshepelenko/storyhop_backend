const { Client } = require('pg');
const axios = require('axios');

const SEASON_ID = 'c01885b7-21ea-4adb-bac2-e14820a0001f';

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Vfksqktv47',
    database: 'storyhop',
  });
  await client.connect();

  const wallet = await client.query('SELECT balance FROM crystal_wallets WHERE "seasonId" = $1', [SEASON_ID]);
  const eps = await client.query(
    `SELECT e."episodeNumber", e."episodeId", se.status AS entry_status, i.status AS ill_status,
            i."imageUrl" IS NOT NULL AS has_url, LEFT(i."imageUrl", 80) AS image_url_prefix
     FROM episodes e
     LEFT JOIN storybook_entries se ON se."episodeId" = e."episodeId" AND se."entryType" = 'episode_illustration'
     LEFT JOIN illustrations i ON i."illustrationId" = se."illustrationId"
     WHERE e."seasonId" = $1 AND e."episodeNumber" >= 30
     ORDER BY e."episodeNumber"`,
    [SEASON_ID],
  );

  console.log(JSON.stringify({ balance: wallet.rows[0], episodes: eps.rows }, null, 2));

  const ep32 = eps.rows.find((row) => row.episodeNumber === 32);
  if (ep32) {
    const unlock = await axios.post(
      `http://localhost:3000/seasons/${SEASON_ID}/storybook/unlock`,
      { episodeId: ep32.episodeId },
      { validateStatus: () => true },
    );
    console.log('unlock ep32:', unlock.status, unlock.data?.message || 'ok');
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
