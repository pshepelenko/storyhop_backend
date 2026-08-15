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

  const ledger = await client.query(
    `SELECT direction, amount, reason, metadata, "createdAt"
     FROM crystal_ledger WHERE "seasonId" = $1
     AND (metadata->>'episodeId' = $2 OR metadata->>'episodeNumber' = '33')
     ORDER BY "createdAt"`,
    [SEASON_ID, EPISODE_ID],
  );
  const wallet = await client.query('SELECT balance FROM crystal_wallets WHERE "seasonId" = $1', [SEASON_ID]);
  console.log(JSON.stringify({ balance: wallet.rows[0], ledger: ledger.rows }, null, 2));
  await client.end();
}

main();
