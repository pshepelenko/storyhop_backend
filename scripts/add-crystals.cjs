const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const SEASON_ID = 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const CREDIT_AMOUNT = 10;

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const walletRes = await client.query(
    `SELECT "walletId", "ownerUserId", balance FROM crystal_wallets WHERE "seasonId" = $1 LIMIT 1`,
    [SEASON_ID],
  );
  if (!walletRes.rows[0]) {
    throw new Error(`Wallet not found for season ${SEASON_ID}`);
  }

  const wallet = walletRes.rows[0];
  const newBalance = Number(wallet.balance) + CREDIT_AMOUNT;
  const now = new Date().toISOString();

  await client.query(
    `UPDATE crystal_wallets SET balance = $1, "updatedAt" = $2 WHERE "walletId" = $3`,
    [newBalance, now, wallet.walletId],
  );

  await client.query(
    `INSERT INTO crystal_ledger (
      "ledgerEntryId", "walletId", "ownerUserId", "seasonId", direction, amount, reason, metadata, "createdAt"
    ) VALUES ($1, $2, $3, $4, 'credit', $5, 'manual_admin_credit', $6::jsonb, $7)`,
    [
      uuidv4(),
      wallet.walletId,
      wallet.ownerUserId,
      SEASON_ID,
      CREDIT_AMOUNT,
      JSON.stringify({ note: 'Manual credit via admin script' }),
      now,
    ],
  );

  console.log(`Season ${SEASON_ID}: ${wallet.balance} -> ${newBalance} crystals`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
