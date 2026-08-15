const axios = require('axios');
const { Client } = require('pg');

const SEASON_ID = 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const EPISODE_ID = '0de67768-6ad6-41d7-b63a-f8cf87ce8116';

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
  const entry = await client.query(
    'SELECT status FROM storybook_entries WHERE "episodeId" = $1 AND "entryType" = $2',
    [EPISODE_ID, 'episode_illustration'],
  );
  const job = await client.query(
    `SELECT status, error FROM generation_jobs WHERE "episodeId" = $1 AND "jobType" = 'image_generation' ORDER BY "updatedAt" DESC LIMIT 1`,
    [EPISODE_ID],
  );
  const debits = await client.query(
    `SELECT COUNT(*)::int AS count FROM crystal_ledger WHERE "seasonId" = $1 AND reason = 'illustration_unlock' AND metadata->>'episodeId' = $2`,
    [SEASON_ID, EPISODE_ID],
  );

  console.log(JSON.stringify({ wallet: wallet.rows[0], entry: entry.rows[0], job: job.rows[0], unlockDebits: debits.rows[0] }, null, 2));

  const unlock = await axios.post(
    `http://localhost:3000/seasons/${SEASON_ID}/storybook/unlock`,
    { episodeId: EPISODE_ID },
    { validateStatus: () => true },
  );
  console.log('unlock response:', unlock.status, unlock.data?.message || 'ok');

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
